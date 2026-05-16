(function(){
  const ENDPOINT = 'https://gre-auth.goenka-aditya-kol.workers.dev/analytics/view';
  const STORAGE_KEY = 'gqp_anon_visitor_id';

  function visitorId(){
    try{
      let id = localStorage.getItem(STORAGE_KEY);
      if(!id){
        id = crypto && crypto.randomUUID ? crypto.randomUUID() : 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    }catch(e){
      return 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function track(){
    const payload = {
      site: 'grequantpro',
      visitorId: visitorId(),
      path: location.pathname,
      title: document.title,
      referrer: document.referrer ? document.referrer.slice(0, 240) : ''
    };
    try{
      fetch(ENDPOINT, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function(){});
    }catch(e){}
  }

  if(document.readyState === 'complete') track();
  else window.addEventListener('load', track, {once:true});
})();
