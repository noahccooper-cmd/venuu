import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.venuu.app',
  appName: 'venuu',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ios: {
    // contentInset removed — was causing a white bar at the
    // bottom of the screen on devices with home indicators.
    // The default ('automatic') respects safe areas correctly
    // and matches the rendering venuu had pre-PROMPT-49a.
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
    },
  },
};

export default config;
