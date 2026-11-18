/* one preview at a time: the Listen button plays the first one, a track with a preview plays when tapped */
(function(){const a=new Audio();a.preload='none';let on=null;const btn=document.getElementById('play');
  function sync(){if(btn){const p=!a.paused&&a.src===btn.dataset.src;btn.querySelector('.i').textContent=!a.paused?'❚❚':'▶'}document.querySelectorAll('.tracks li').forEach(li=>li.classList.toggle('on',!a.paused&&li.dataset.src===a.src))}
  function play(src){if(a.src===src&&!a.paused){a.pause();return}if(a.src!==src)a.src=src;a.play().catch(()=>{})}
  if(btn)btn.onclick=()=>{if(!a.paused){a.pause();return}play(a.src&&a.src!==location.href?a.src:btn.dataset.src)};
  document.querySelectorAll('.tracks li[data-src]').forEach(li=>li.onclick=()=>play(li.dataset.src));
  ['play','pause','ended'].forEach(k=>a.addEventListener(k,sync));
})();
