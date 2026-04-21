import React from 'react';
import { HeartPulse, ActivitySquare, Thermometer, Apple } from 'lucide-react';

// Health tracking page with massive typography for vitals
const Health: React.FC = () => {
  return (
    <div className="p-12 h-full overflow-y-auto">
      <header className="mb-12">
        <h2 className="text-5xl font-extrabold text-foreground mb-4">健康管理</h2>
        <p className="text-2xl text-muted-foreground font-medium">随时关注您的身体状况，保持健康活力。</p>
      </header>

      {/* Big Vitals Grid */}
      <div className="grid grid-cols-2 gap-8 mb-12">
        <div className="bg-red-50 border-2 border-red-100 rounded-[2.5rem] p-10 flex flex-col items-center justify-center shadow-custom relative overflow-hidden">
          <HeartPulse className="text-red-200 absolute -right-4 -top-4" size={200} />
          <div className="relative z-10 text-center">
            <h3 className="text-3xl font-bold text-red-800 mb-6 flex items-center justify-center gap-3">
              <HeartPulse size={40} /> 最新心率
            </h3>
            <div className="flex items-baseline justify-center gap-2 mb-4">
              <span className="text-[6rem] font-black text-red-600 leading-none">75</span>
              <span className="text-3xl font-bold text-red-500">次/分</span>
            </div>
            <div className="inline-block px-6 py-2 bg-red-600 text-white text-xl font-bold rounded-full">
              状态正常
            </div>
          </div>
        </div>

        <div className="bg-indigo-50 border-2 border-indigo-100 rounded-[2.5rem] p-10 flex flex-col items-center justify-center shadow-custom relative overflow-hidden">
          <ActivitySquare className="text-indigo-200 absolute -right-4 -top-4" size={200} />
          <div className="relative z-10 text-center">
            <h3 className="text-3xl font-bold text-indigo-900 mb-6 flex items-center justify-center gap-3">
              <ActivitySquare size={40} /> 最新血压
            </h3>
            <div className="flex items-baseline justify-center gap-2 mb-4">
              <span className="text-[5rem] font-black text-indigo-700 leading-none">120/80</span>
              <span className="text-3xl font-bold text-indigo-500">mmHg</span>
            </div>
            <div className="inline-block px-6 py-2 bg-indigo-600 text-white text-xl font-bold rounded-full">
              状态良好
            </div>
          </div>
        </div>
      </div>

      {/* Secondary Metrics */}
      <h3 className="text-3xl font-bold text-foreground mb-6">今日健康建议</h3>
      <div className="grid grid-cols-2 gap-8">
        <div className="bg-card p-8 rounded-3xl shadow-custom border border-border flex items-center gap-6">
          <div className="bg-orange-100 p-5 rounded-2xl">
            <Thermometer className="text-orange-600" size={48} />
          </div>
          <div>
            <h4 className="text-2xl font-bold text-foreground mb-2">气温变化提醒</h4>
            <p className="text-xl text-muted-foreground">今天下午有降温，出门请记得多加一件外套。</p>
          </div>
        </div>
        
        <div className="bg-card p-8 rounded-3xl shadow-custom border border-border flex items-center gap-6">
          <div className="bg-green-100 p-5 rounded-2xl">
            <Apple className="text-green-600" size={48} />
          </div>
          <div>
            <h4 className="text-2xl font-bold text-foreground mb-2">饮食建议</h4>
            <p className="text-xl text-muted-foreground">今天建议多吃蔬菜，饭后可以吃个苹果助消化。</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Health;