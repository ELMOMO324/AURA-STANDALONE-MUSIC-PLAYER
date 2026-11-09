'use strict';
const {spawn}=require('child_process');
const https=require('https');
module.exports=function createOnlineBridge({downloader,port,publicBase,spawnProcess=spawn,httpsGet=https.get}){
  const cache=new Map(),pending=new Map();let searches=0,resolutions=0,streams=0;
  const allowedSource=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='googlevideo.com'||u.hostname.endsWith('.googlevideo.com'));}catch{return false;}};
  function extract(args,timeout=45000,signal){return new Promise((resolve,reject)=>{
    const child=spawnProcess(downloader,['--ignore-config','--no-warnings','--socket-timeout','20','--retries','1',...args],{windowsHide:true});
    let out='',err='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill();finish(Error('Solicitud cancelada.'));};
    const timer=setTimeout(()=>{child.kill();finish(Error('YouTube tardo demasiado en responder. Vuelve a intentarlo.'));},timeout);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',data=>{out+=data;if(out.length>12*1024*1024){child.kill();finish(Error('Respuesta de YouTube demasiado grande.'));}});
    child.stderr.on('data',data=>{err=(err+data).slice(-4000);});
    child.on('error',error=>finish(Error('No se pudo iniciar la busqueda de YouTube ('+error.code+').')));
    child.on('close',code=>{if(settled)return;try{const data=JSON.parse(out);if(code!==0&&!data.entries)throw Error();finish(null,data);}catch{finish(Error(err.trim().slice(-700)||'No se pudo consultar YouTube.'));}});
  });}
  async function source(id){
    const known=cache.get(id);if(known&&known.until>Date.now())return known;
    if(pending.has(id))return pending.get(id);
    if(resolutions>=2)throw Error('Se estan preparando otras canciones. Espera unos segundos.');
    resolutions++;
    const task=(async()=>{const info=await extract(['--no-playlist','--skip-download','--dump-single-json','--js-runtimes','node:'+process.execPath,'-f','bestaudio[ext=m4a][protocol=https]/bestaudio[protocol=https]','--','https://www.youtube.com/watch?v='+id]);
      if(info.is_live||info.live_status==='is_live')throw Error('Esta funcion reproduce canciones y videos grabados, no emisiones en directo.');
      if(!allowedSource(info.url))throw Error('Este video no ofrece un stream de audio compatible.');
      // YouTube exige esperar antes de usar los enlaces recien generados (igual que yt-dlp al descargar).
      await new Promise(resolve=>setTimeout(resolve,5250));
      const value={headers:info.http_headers||{},url:info.url,type:info.ext==='m4a'?'audio/mp4':info.ext==='webm'?'audio/webm':'audio/ogg',agent:info.http_headers?.['User-Agent']||'Mozilla/5.0',until:Date.now()+4*60*1000};
      if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(id,value);return value;
    })();pending.set(id,task);
    try{return await task;}finally{pending.delete(id);resolutions--;}
  }
  function proxy(req,res,src,json,redirects=0){
    if(!allowedSource(src.url)||redirects>3)return json(502,{error:'Origen de audio no compatible.'});
    if(req.headers.range&&!/^bytes=\d*-\d*$/.test(req.headers.range))return json(416,{error:'Rango no valido.'});
    const headers={'User-Agent':src.agent,'Accept-Encoding':'identity'};for(const name of ['Accept','Accept-Language','Sec-Fetch-Mode']){const value=src.headers[name];if(typeof value==='string'&&!/[\r\n]/.test(value))headers[name]=value;}if(req.headers.range)headers.Range=req.headers.range;
    const upstream=httpsGet(src.url,{headers,timeout:30000},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){const location=new URL(response.headers.location||'',src.url).href;response.resume();proxy(req,res,{...src,url:location},json,redirects+1);return;}
      if(![200,206,416].includes(response.statusCode)){response.resume();return json(502,{error:'YouTube no pudo transmitir esta cancion. Prueba otro resultado.'});}
      const output={'Content-Type':src.type,'Accept-Ranges':response.headers['accept-ranges']||'bytes','Cache-Control':'no-store','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges'};
      for(const name of ['content-length','content-range'])if(response.headers[name])output[name]=response.headers[name];
      res.writeHead(response.statusCode,output);if(req.method==='HEAD'){response.destroy();res.end();return;}
      streams++;let released=false;const release=()=>{if(!released){released=true;streams--;}};
      response.on('end',release);response.on('close',release);response.on('error',()=>{release();res.destroy();});
      res.on('close',()=>{release();response.destroy();upstream.destroy();});response.pipe(res);
    });
    upstream.on('timeout',()=>upstream.destroy(Error('Tiempo de transmision agotado.')));
    upstream.on('error',()=>{if(!res.headersSent)json(502,{error:'Se interrumpio la conexion con YouTube.'});else res.destroy();});
    res.on('close',()=>upstream.destroy());
  }
  const route=async(req,res,url,json)=>{try{
    if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Metodo no permitido.'});
    if(url.pathname==='/online/search'){
      const query=(url.searchParams.get('q')||'').trim();const page=Number(url.searchParams.get('page')||1);
      if(query.length<2||query.length>200||!Number.isInteger(page)||page<1||page>5)return json(400,{error:'Escribe entre 2 y 200 caracteres para buscar.'});
      if(searches>=2)return json(429,{error:'Hay otras busquedas en curso. Espera unos segundos.'});
      searches++;const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort();});
      try{const info=await extract(['--flat-playlist','--dump-single-json','--ignore-errors','--',`ytsearch${page*20}:${query}`],90000,controller.signal);
        const entries=(info.entries||[]).slice((page-1)*20,page*20).filter(e=>e&&/^[\w-]{11}$/.test(e.id)&&!e.is_live&&e.live_status!=='is_live').map(e=>({id:'online_'+e.id,youtubeId:e.id,title:e.title||'Video de YouTube',artist:e.uploader||e.channel||'YouTube',duration:e.duration||0,coverUrl:'https://img.youtube.com/vi/'+e.id+'/hqdefault.jpg',audioUrl:`${publicBase || `http://127.0.0.1:${port}`}/online/stream?id=${e.id}`,source:'youtube-online'}));
        json(200,{tracks:entries,page,hasMore:page<5&&(info.entries||[]).length>=page*20});
      }finally{searches--;}
    }else if(url.pathname==='/online/stream'){
      const id=url.searchParams.get('id');if(!/^[\w-]{11}$/.test(id||''))return json(400,{error:'Video no valido.'});
      const src=await source(id);if(!res.destroyed)proxy(req,res,src,json);
    }else json(404,{error:'Ruta online no encontrada.'});
  }catch(error){json(502,{error:error.message});}};
  route.status=()=>({activeStreams:streams,activeSearches:searches,activeResolutions:resolutions});return route;
};
