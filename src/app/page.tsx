"use client";

import { useState, useEffect, useCallback } from "react";
import CharacterSelect from "@/components/CharacterSelect";
import SetupScreen from "@/components/SetupScreen";
import GameScreen from "@/components/GameScreen";

export interface HeroineConfig {
  name: string;
  persona: string;
  tone: string;
  imageUrl: string | null;
  /** 差分画像マップ: ラベル(例: "照れ") → base64 data URL */
  expressions: Record<string, string>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CharacterData {
  id: string;
  config: HeroineConfig;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY_CHARACTERS = "ai-renai-characters";
const STORAGE_KEY_ACTIVE = "ai-renai-active-char";
const STORAGE_KEY_PHASE = "ai-renai-phase";

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded, etc. */ }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function Home() {
  const [phase, setPhase] = useState<"select" | "setup" | "game">("select");
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [activeCharId, setActiveCharId] = useState<string | null>(null);
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Restore saved state on mount
  useEffect(() => {
    const savedChars = loadFromStorage<CharacterData[]>(STORAGE_KEY_CHARACTERS, []);
    const savedActive = loadFromStorage<string | null>(STORAGE_KEY_ACTIVE, null);
    const savedPhase = loadFromStorage<string>(STORAGE_KEY_PHASE, "select");

    setCharacters(savedChars);

    // Migrate old single-character data if exists
    const oldConfig = loadFromStorage<HeroineConfig | null>("ai-renai-config", null);
    if (oldConfig && savedChars.length === 0) {
      const oldMessages = loadFromStorage<ChatMessage[]>("ai-renai-messages", []);
      const migrated: CharacterData = {
        id: generateId(),
        config: { ...oldConfig, expressions: oldConfig.expressions ?? {} },
        messages: oldMessages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setCharacters([migrated]);
      saveToStorage(STORAGE_KEY_CHARACTERS, [migrated]);
      // Clean old keys
      localStorage.removeItem("ai-renai-config");
      localStorage.removeItem("ai-renai-messages");
      localStorage.removeItem("ai-renai-phase");
    }

    if (savedPhase === "game" && savedActive && savedChars.some(c => c.id === savedActive)) {
      setActiveCharId(savedActive);
      setPhase("game");
    }

    // Auto-switch to saved model on startup
    const savedModel = localStorage.getItem("ai-renai-model");
    if (savedModel) {
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke<string>("switch_model", { modelName: savedModel }).catch((err) => {
          console.warn("[恋AI] Failed to auto-switch model:", err);
        });
      });
    }

    setIsHydrated(true);
  }, []);

  const saveCharacters = useCallback((chars: CharacterData[]) => {
    setCharacters(chars);
    saveToStorage(STORAGE_KEY_CHARACTERS, chars);
  }, []);

  const handleNewCharacter = () => {
    setEditingCharId(null);
    setPhase("setup");
    saveToStorage(STORAGE_KEY_PHASE, "setup");
  };

  const handleEditCharacter = (id: string) => {
    setEditingCharId(id);
    setPhase("setup");
    saveToStorage(STORAGE_KEY_PHASE, "setup");
  };

  const handleDeleteCharacter = (id: string) => {
    const updated = characters.filter(c => c.id !== id);
    saveCharacters(updated);
    if (activeCharId === id) {
      setActiveCharId(null);
      saveToStorage(STORAGE_KEY_ACTIVE, null);
    }
  };

  const handleStartGame = (charId: string) => {
    setActiveCharId(charId);
    setPhase("game");
    saveToStorage(STORAGE_KEY_ACTIVE, charId);
    saveToStorage(STORAGE_KEY_PHASE, "game");
  };

  const handleSaveConfig = (config: HeroineConfig) => {
    const now = Date.now();
    if (editingCharId) {
      // Update existing
      const updated = characters.map(c =>
        c.id === editingCharId ? { ...c, config, updatedAt: now } : c
      );
      saveCharacters(updated);
      setPhase("select");
    } else {
      // Create new
      const newChar: CharacterData = {
        id: generateId(),
        config,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      saveCharacters([...characters, newChar]);
      setPhase("select");
    }
    saveToStorage(STORAGE_KEY_PHASE, "select");
  };

  const handleBackToSelect = () => {
    setPhase("select");
    saveToStorage(STORAGE_KEY_PHASE, "select");
  };

  const handleMessagesChange = useCallback((messages: ChatMessage[]) => {
    if (!activeCharId) return;
    setCharacters(prev => {
      const updated = prev.map(c =>
        c.id === activeCharId ? { ...c, messages, updatedAt: Date.now() } : c
      );
      saveToStorage(STORAGE_KEY_CHARACTERS, updated);
      return updated;
    });
  }, [activeCharId]);

  if (!isHydrated) {
    return <main className="h-dvh w-full overflow-hidden bg-bg" />;
  }

  const activeChar = characters.find(c => c.id === activeCharId);
  const editingChar = characters.find(c => c.id === editingCharId);

  return (
    <main className="h-dvh w-full overflow-hidden bg-bg">
      {phase === "select" && (
        <CharacterSelect
          characters={characters}
          onSelect={handleStartGame}
          onNew={handleNewCharacter}
          onEdit={handleEditCharacter}
          onDelete={handleDeleteCharacter}
        />
      )}
      {phase === "setup" && (
        <SetupScreen
          onSave={handleSaveConfig}
          onBack={handleBackToSelect}
          savedConfig={editingChar?.config ?? null}
          isEditing={!!editingCharId}
        />
      )}
      {phase === "game" && activeChar && (
        <GameScreen
          config={activeChar.config}
          onBack={handleBackToSelect}
          initialMessages={activeChar.messages}
          onMessagesChange={handleMessagesChange}
        />
      )}
    </main>
  );
}
