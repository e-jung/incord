// No support prompt is shown until the instance explicitly configures a URL.
fetch('/api/config',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(config=>{
  if(typeof config?.donateUrl!=='string')return;
  const url=new URL(config.donateUrl);if(url.protocol!=='https:'||url.username||url.password)return;
  const link=document.getElementById('support-incord');if(link){link.href=url.href;link.hidden=false}
}).catch(()=>{});
