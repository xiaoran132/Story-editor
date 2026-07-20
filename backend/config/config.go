package config

import (
	"fmt"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

type Config struct {
	DBHost       string `mapstructure:"DB_HOST"`
	DBPort       string `mapstructure:"DB_PORT"`
	DBUser       string `mapstructure:"DB_USER"`
	DBPassword   string `mapstructure:"DB_PASSWORD"`
	DBName       string `mapstructure:"DB_NAME"`
	JWTSecret    string `mapstructure:"JWT_SECRET"`
	ServerPort   string `mapstructure:"SERVER_PORT"`
	AIServiceURL string `mapstructure:"AI_SERVICE_URL"`
}

func (c *Config) DSN() string {
	return fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=disable TimeZone=Asia/Shanghai",
		c.DBHost, c.DBUser, c.DBPassword, c.DBName, c.DBPort)
}

func Load(configPath string) (*Config, error) {
	// 加载 .env 到环境变量（存在则加载，不存在忽略）；随后由 viper 读取
	_ = godotenv.Load()

	v := viper.New()

	if configPath != "" {
		v.SetConfigFile(configPath)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath("./config")
		v.AddConfigPath(".")
	}

	v.AutomaticEnv()

	_ = v.BindEnv("DB_HOST")
	_ = v.BindEnv("DB_PORT")
	_ = v.BindEnv("DB_USER")
	_ = v.BindEnv("DB_PASSWORD")
	_ = v.BindEnv("DB_NAME")
	_ = v.BindEnv("JWT_SECRET")
	_ = v.BindEnv("SERVER_PORT")
	_ = v.BindEnv("AI_SERVICE_URL")

	setDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("DB_HOST", "localhost")
	v.SetDefault("DB_PORT", "5432")
	v.SetDefault("DB_USER", "postgres")
	v.SetDefault("DB_PASSWORD", "postgres")
	v.SetDefault("DB_NAME", "story_editor")
	v.SetDefault("JWT_SECRET", "change-me-in-production")
	v.SetDefault("SERVER_PORT", ":8080")
	v.SetDefault("AI_SERVICE_URL", "http://localhost:8001")
}
