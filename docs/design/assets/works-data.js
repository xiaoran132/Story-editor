/* Shared work data for Wanxiang. */
(function(){
  'use strict';
  var WORKS = [
      {key:'radio', playable:true, n:'最后的深夜电台',k:'末世 · 电台',h:252,v:'signal',f:'radio',cover:'assets/covers/web-pixel-landscape.png',coverStyle:'网络像素艺术',coverClass:'pixel-cover',t:'电流杂音里，有人在呼救。你是否回应？',w:'末世的第七个雨夜。城市在一场无人能解释的「低语」中崩溃。',a:['理智','体温','物资 · 渐显','警觉 · 隐藏'],p:'2.4万',l:'1284'},
      {key:'opera', playable:false, n:'戏楼夜半开锣',k:'民国 · 怪谈',h:16,v:'stage',f:'gaze',cover:'assets/covers/web-anime-girl.png',coverStyle:'网络二次元插画',t:'戏还没散，台下的人却一个都没走。',w:'城南的老戏楼荒废了三十年。今夜你推开了那扇门。',a:['惊惧 · 隐藏','清醒','旧物'],p:'1.1万',l:'876'},
      {key:'sun', playable:false, n:'把太阳寄给你',k:'星海 · 软科幻',h:276,v:'orbit',f:'reach',cover:'assets/covers/web-collage.jpg',coverStyle:'网络拼贴艺术',t:'末班星舰起航前，我想把一整个夏天寄出去。',w:'星舰将在黎明起航，一去不返。收件人在另一条时间线里。',a:['信念','光年','夏天 · 渐显'],p:'8632',l:'2103'},
      {key:'blade', playable:false, n:'雪满刀锋',k:'江湖 · 武侠',h:168,v:'blade',f:'blade',cover:'assets/covers/web-great-wave.jpg',coverStyle:'浮世绘版画',t:'你握刀的手在抖——是冷，还是怕？',w:'大雪封城的除夕，你奉命护送一具棺材出关。',a:['刀意','伤势','声名'],p:'1.9万',l:'1542'},
      {key:'sakura', playable:false, n:'樱花落下的速度',k:'校园 · 恋爱',h:340,v:'petal',f:'walk',cover:'assets/covers/web-watercolor-flowers.jpg',coverStyle:'网络水彩花卉',t:'每秒五厘米，而你走得比这更慢。',w:'此后三年，你每天都比预定时间早出门七分钟。',a:['心动','距离','未寄出的信'],p:'3.7万',l:'2860'},
      {key:'neon', playable:false, n:'霧虹不眠',k:'赛博 · 黑客',h:312,v:'grid',f:'umbrella',cover:'assets/covers/web-neon-hong-kong.jpg',coverStyle:'网络夜景摄影',t:'这座城市把你的记忆卖了个好价钱。',w:'你在黑市醒来，少了三年记忆和一根手指。',a:['算力','嫌疑度 · 隐藏','义体'],p:'6210',l:'993'},
      {key:'immortal', playable:false, n:'斩却三千烦恼',k:'仙侠 · 飞升',h:72,v:'cloud',f:'blade',cover:'assets/covers/web-ink-landscape.jpg',coverStyle:'古典水墨山水',t:'渡劫这一步，你打算带着谁一起？',w:'你修行三百年，今夜雷云压顶。',a:['道心','雷劫','尘缘 · 渐显'],p:'5.2万',l:'3410'},
      {key:'bakery', playable:false, n:'街角面包店的第七年',k:'温情 · 日常',h:132,v:'bakery',f:'walk',cover:'assets/covers/web-film-texture.jpg',coverStyle:'网络胶片纹理',t:'今天也有人推门进来，说「和往常一样。」',w:'没有惊天动地的剧情，只有每天推门进来的人。',a:['手感','熟客','心事 · 渐显'],p:'9014',l:'658'},
      {key:'guest', playable:false, n:'第十三位客人',k:'悬疑 · 本格',h:238,v:'table',f:'gaze',cover:'assets/covers/web-noir-interior.jpg',coverStyle:'网络黑白摄影',t:'名单上只有十二个人，可餐桌坐满了十三个。',w:'暴雪封山的庄园晚宴，多出来的那个人正在微笑。',a:['推理','信任度','线索'],p:'1.4万',l:'1120'},
      {key:'rust', playable:false, n:'锈海行舟',k:'废土 · 机械',h:38,v:'vehicle',f:'reach',cover:'assets/covers/web-retro-car.jpg',coverStyle:'网络汽车摄影',t:'引擎还剩最后一格油，前方是海市蜃楼。',w:'你和一台快散架的陆行舰，已经开了九百公里。',a:['燃料','船体','幻觉 · 隐藏'],p:'7788',l:'742'},
      {key:'diver', playable:false, n:'深潜者笔记',k:'深海 · 异闻',h:196,v:'sonar',f:'gaze',cover:'assets/covers/web-blueprint-people.jpg',coverStyle:'网络蓝图摄影',t:'下潜到第八百米时，声呐照出了不该有的轮廓。',w:'你是「白鲸号」最后一名潜航员。',a:['氧气','水压','认知 · 隐藏'],p:'4520',l:'1683'},
      {key:'cicada', playable:false, n:'蝉鸣停止的那天',k:'夏日 · 奇谭',h:96,v:'cicada',f:'walk',cover:'assets/covers/web-papercut.jpg',coverStyle:'网络剪纸静物',t:'那年夏天很长，长到我以为它不会结束。',w:'八月十四日下午三点，全镇的蝉同时安静了。',a:['记忆','体力','循环次数'],p:'2.8万',l:'2214'}
    ];
  var BY_KEY = {};
  WORKS.forEach(function(work){ BY_KEY[work.key] = work; });
  function link(work){
    var key = work && work.key ? work.key : 'radio';
    return work && work.playable
      ? 'play-story.html?world=' + encodeURIComponent(key)
      : 'derivation-graph.html?world=' + encodeURIComponent(key);
  }
  window.WANXIANG_WORKS = WORKS;
  window.WANXIANG_WORKS_BY_KEY = BY_KEY;
  window.WANXIANG_WORK = function(key){ return BY_KEY[String(key || '').toLowerCase()] || null; };
  window.WANXIANG_WORK_LINK = link;
}());
