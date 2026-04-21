import React from 'react';
import { User, VolumeX, Eye, BellRing, Phone } from 'lucide-react';

// Profile and settings with oversized controls
const Profile: React.FC = () => {
  return (
    <div className="p-12 h-full overflow-y-auto">
      <header className="mb-12">
        <h2 className="text-5xl font-extrabold text-foreground mb-4">个人中心</h2>
        <p className="text-2xl text-muted-foreground font-medium">管理您的个人信息和偏好设置。</p>
      </header>

      <div className="grid grid-cols-2 gap-12">
        {/* Left Column: Profile & Family */}
        <div className="flex flex-col gap-8">
          <div className="bg-card border-2 border-border rounded-[2.5rem] p-10 flex items-center gap-8 shadow-custom">
            <div className="w-32 h-32 bg-primary rounded-full flex items-center justify-center shadow-inner">
              <User size={64} className="text-white" />
            </div>
            <div>
              <h3 className="text-4xl font-bold text-foreground mb-2">李爷爷</h3>
              <p className="text-2xl text-muted-foreground">ID: 10086</p>
            </div>
          </div>

          <div className="bg-card border-2 border-border rounded-[2.5rem] p-10 shadow-custom">
            <h3 className="text-3xl font-bold text-foreground mb-8 border-b pb-4">我的家人</h3>
            <div className="flex items-center justify-between p-6 bg-secondary/30 rounded-2xl mb-4 border border-secondary">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-2xl">
                  儿
                </div>
                <span className="text-3xl font-bold">大儿子 (建国)</span>
              </div>
              <button className="p-4 bg-green-500 rounded-full text-white hover:bg-green-600 hover:scale-105 transition-all">
                <Phone size={36} />
              </button>
            </div>
            <div className="flex items-center justify-between p-6 bg-secondary/30 rounded-2xl border border-secondary">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center text-pink-600 font-bold text-2xl">
                  女
                </div>
                <span className="text-3xl font-bold">小女儿 (建华)</span>
              </div>
              <button className="p-4 bg-green-500 rounded-full text-white hover:bg-green-600 hover:scale-105 transition-all">
                <Phone size={36} />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Settings */}
        <div className="bg-card border-2 border-border rounded-[2.5rem] p-10 shadow-custom h-fit">
          <h3 className="text-3xl font-bold text-foreground mb-8 border-b pb-4">常用设置</h3>
          
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between p-6 hover:bg-muted rounded-2xl transition-colors cursor-pointer">
              <div className="flex items-center gap-6">
                <Eye size={40} className="text-primary" />
                <span className="text-3xl font-medium">字体大小调整</span>
              </div>
              <div className="text-2xl text-muted-foreground font-bold bg-secondary px-4 py-2 rounded-lg">大号</div>
            </div>

            <div className="flex items-center justify-between p-6 hover:bg-muted rounded-2xl transition-colors cursor-pointer">
              <div className="flex items-center gap-6">
                <VolumeX size={40} className="text-primary" />
                <span className="text-3xl font-medium">系统音量调节</span>
              </div>
              <div className="text-2xl text-muted-foreground font-bold bg-secondary px-4 py-2 rounded-lg">大音量</div>
            </div>

            <div className="flex items-center justify-between p-6 hover:bg-muted rounded-2xl transition-colors cursor-pointer">
              <div className="flex items-center gap-6">
                <BellRing size={40} className="text-primary" />
                <span className="text-3xl font-medium">消息语音播报</span>
              </div>
              <div className="w-20 h-10 bg-primary rounded-full relative shadow-inner">
                <div className="w-12 h-12 bg-white rounded-full absolute -top-1 right-0 shadow border border-border"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Profile;