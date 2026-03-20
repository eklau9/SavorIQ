import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { RestaurantProvider } from '@/lib/RestaurantContext';
import { colors } from '@/lib/theme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

const savoriqTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent.gold,
    background: colors.bg.primary,
    card: colors.bg.secondary,
    text: colors.text.primary,
    border: colors.border.subtle,
    notification: colors.accent.red,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...Ionicons.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  return (
    <RestaurantProvider>
        <ThemeProvider value={savoriqTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="guest/[id]"
              options={{
                presentation: 'modal',
                headerStyle: { backgroundColor: colors.bg.secondary },
                headerTintColor: colors.text.primary,
                title: 'Guest Profile',
              }}
            />
          </Stack>
        </ThemeProvider>
    </RestaurantProvider>
  );
}
