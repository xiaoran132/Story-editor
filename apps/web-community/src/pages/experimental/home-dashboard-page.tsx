import React from 'react';
import { Sun, Pill, CalendarHeart, Mic } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Dashboard / Home page with quick overviews
const Home: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="p-12 h-full flex flex-col">
      {/* Header Greeting */}
      <header className="mb-10 flex justify-between items-end">
        <div>
          <h2 className="text-5xl font-extrabold text-foreground mb-4">早上好，李爷爷</h2>
          <p className="text-2xl text-muted-foreground font-medium">今天是 10月24日 星期二，祝您心情愉快。</p>
        </div>
        <div className="bg-secondary px-6 py-4 rounded-2xl flex items-center gap-4 shadow-custom">
          <Sun className="text-primary" size={48} />
          <div>
            <div className="text-3xl font-bold text-foreground">22°C</div>
            <div className="text-xl text-secondary-foreground">晴朗 · 适宜外出</div>
          </div>
        </div>
      </header>

      {/* Main Action Area */}
      <div className="grid grid-cols-3 gap-8 mb-10 flex-1">
        {/* Giant Chat Button */}
        <button 
          onClick={() => navigate('/chat')}
          className="col-span-2 bg-gradient-to-br from-primary to-orange-400 rounded-[2.5rem] p-12 flex flex-col justify-center items-center text-primary-foreground shadow-[0_12px_40px_rgba(250,140,22,0.3)] hover:scale-[1.02] transition-transform"
        >
          <div className="bg-white/20 p-8 rounded-full mb-8">
            <Mic size={100} strokeWidth={2} />
          </div>
          <h3 className="text-5xl font-bold mb-4">找维塔聊天</h3>
          <p className="text-2xl text-white/90">点击这里，随时陪您说话</p>
        </button>

        {/* Reminders Column */}
        <div className="col-span-1 flex flex-col gap-8">
          <div className="bg-card p-8 rounded-[2.5rem] shadow-custom flex-1 border-2 border-border/50">
            <div className="flex items-center gap-4 mb-6">
              <div className="bg-blue-100 p-4 rounded-full">
                <Pill className="text-blue-600" size={36} />
              </div>
              <h3 className="text-3xl font-bold">吃药提醒</h3>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-4">
              <div className="text-2xl font-bold text-blue-900 mb-2">上午 09:00</div>
              <div className="text-2xl text-blue-800">降压药 (2片)</div>
            </div>
            <button className="w-full py-4 bg-blue-600 text-white text-2xl font-bold rounded-2xl hover:bg-blue-700 transition-colors">
              我已服药
            </button>
          </div>

          <div className="bg-card p-8 rounded-[2.5rem] shadow-custom flex-1 border-2 border-border/50">
            <div className="flex items-center gap-4 mb-6">
              <div className="bg-green-100 p-4 rounded-full">
                <CalendarHeart className="text-green-600" size={36} />
              </div>
              <h3 className="text-3xl font-bold">今日日程</h3>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4 text-2xl bg-green-50 p-4 rounded-2xl">
                <span className="font-bold text-green-700">10:30</span>
                <span>下楼散步</span>
              </div>
              <div className="flex items-center gap-4 text-2xl bg-green-50 p-4 rounded-2xl">
                <span className="font-bold text-green-700">15:00</span>
                <span>听戏曲广播</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;