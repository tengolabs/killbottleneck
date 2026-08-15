import React, { useState } from "react";
import ServerPicker from "@/pages/ServerPicker";
import Signup from "@/pages/Signup";

// Jen nativní obal: vstup bez zvoleného serveru. Stavový automat místo
// Routeru — po volbě serveru se stejně dělá plný reload (pb.js čte adresu
// při module load), takže historie nemá co držet. Hardwarové „zpět" na
// Signupu řeší Signup sám přes pushState/popstate.
export default function NativeOnboarding() {
  const [screen, setScreen] = useState("picker"); // picker | signup
  const [prefill, setPrefill] = useState("");

  if (screen === "signup") {
    return (
      <Signup
        onBack={() => setScreen("picker")}
        onUseSlug={(slug) => {
          setPrefill(slug || "");
          setScreen("picker");
        }}
      />
    );
  }
  return <ServerPicker initialValue={prefill} onSignup={() => setScreen("signup")} />;
}
