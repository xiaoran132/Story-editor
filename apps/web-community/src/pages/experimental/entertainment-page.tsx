import React from 'react';
import { PlayCircle, Radio, Tv, BookOpen } from 'lucide-react';

// Entertainment hub with massive touch targets for media
const Entertainment: React.FC = () => {
  const categories = [
    { title: '经典戏曲', icon: Tv, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    { title: '怀旧老歌', icon: Radio, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { title: '评书相声', icon: BookOpen, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  ];

  return (
    <div className="p-12 h-full overflow-y-auto">
      <header className="mb-12">
        <h2 className="text-5xl font-extrabold text-foreground mb-4">休闲娱乐</h2>
        <p className="text-2xl text-muted-foreground font-medium">听听戏、唱唱歌，让每天的生活更丰富。</p>
      </header>

      {/* Currently Playing Card */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-[2.5rem] p-10 mb-12 shadow-custom text-white flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="w-32 h-32 bg-white/20 rounded-full flex items-center justify-center animate-pulse">
            <Radio size={64} />
          </div>
          <div>
            <div className="text-xl font-bold text-white/70 mb-2">正在播放：怀旧金曲广播</div>
            <h3 className="text-5xl font-bold mb-4">甜蜜蜜 - 邓丽君</h3>
            <div className="w-64 h-2 bg-white/30 rounded-full overflow-hidden">
              <div className="w-1/3 h-full bg-primary rounded-full"></div>
            </div>
          </div>
        </div>
        <button className="w-32 h-32 bg-primary rounded-full flex items-center justify-center hover:bg-orange-500 transition-colors shadow-[0_0_30px_rgba(250,140,22,0.4)] hover:scale-105">
          <PlayCircle size={80} className="ml-2" />
        </button>
      </div>

      {/* Categories */}
      <h3 className="text-3xl font-bold text-foreground mb-8">为您推荐</h3>
      <div className="grid grid-cols-3 gap-8">
        {categories.map((cat, index) => (
          <div key={index} className={`${cat.bg} border-2 ${cat.border} rounded-3xl p-8 flex flex-col items-center text-center cursor-pointer hover:shadow-custom hover:-translate-y-2 transition-all`}>
            <div className="bg-white p-6 rounded-full mb-6 shadow-sm">
              <cat.icon className={cat.color} size={64} />
            </div>
            <h4 className="text-3xl font-bold text-foreground mb-4">{cat.title}</h4>
            <button className={`w-full py-4 bg-white ${cat.color} rounded-2xl text-2xl font-bold border-2 ${cat.border}`}>
              点击收听
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Entertainment;