import { useEffect, useState } from "react";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAccessToken } from "./src/lib/auth";
import { LoginScreen } from "./src/screens/LoginScreen";
import { DocumentListScreen } from "./src/screens/DocumentListScreen";
import { DocumentDetailScreen } from "./src/screens/DocumentDetailScreen";

const queryClient = new QueryClient();

type Screen = { name: "login" } | { name: "list" } | { name: "detail"; documentId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "login" });
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    getAccessToken().then((token) => {
      setScreen(token ? { name: "list" } : { name: "login" });
      setCheckingSession(false);
    });
  }, []);

  if (checkingSession) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0b1220" }}>
        <ActivityIndicator color="#93c5fd" />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar barStyle="light-content" />
      {screen.name === "login" && <LoginScreen onLoggedIn={() => setScreen({ name: "list" })} />}
      {screen.name === "list" && (
        <DocumentListScreen
          onSelectDocument={(documentId) => setScreen({ name: "detail", documentId })}
          onLoggedOut={() => setScreen({ name: "login" })}
        />
      )}
      {screen.name === "detail" && (
        <DocumentDetailScreen documentId={screen.documentId} onBack={() => setScreen({ name: "list" })} />
      )}
    </QueryClientProvider>
  );
}
