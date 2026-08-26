import Constants from "expo-constants";

// 10.0.2.2 is the Android emulator's alias for the host machine's localhost.
// Override via app.json's expo.extra.apiBaseUrl for a device on the same LAN
// or a deployed backend.
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://10.0.2.2:4000";
