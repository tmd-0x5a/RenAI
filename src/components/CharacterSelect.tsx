"use client";

import { useState, useEffect } from "react";
import type { CharacterData } from "@/app/page";
import { invoke } from "@tauri-apps/api/core";
import { getImageSrc } from "@/lib/utils";

interface CharacterSelectProps {
  characters: CharacterData[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function CharacterSelect({ characters, onSelect, onNew, onEdit, onDelete }: CharacterSelectProps) {
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isSwitching, setIsSwitching] = useState(false);
  const [modelStatus, setModelStatus] = useState<string>("");

  useEffect(() => {
    invoke<string[]>("list_models")
      .then((modelList) => {
        setModels(modelList);
        const saved = localStorage.getItem("ai-renai-model");
        if (saved && modelList.includes(saved)) {
          setSelectedModel(saved);
        } else if (modelList.length > 0) {
          setSelectedModel(modelList[0]);
        }
      })
      .catch((err) => console.error("Failed to list models:", err));
  }, []);

  const handleSwitchModel = async () => {
    if (!selectedModel || isSwitching) return;
    setIsSwitching(true);
    setModelStatus("モデルを読み込み中...");
    try {
      await invoke<string>("switch_model", { modelName: selectedModel });
      localStorage.setItem("ai-renai-model", selectedModel);
      setModelStatus("✓ 切替完了");
      setTimeout(() => setModelStatus(""), 3000);
    } catch (err) {
      console.error("Failed to switch model:", err);
      setModelStatus("✗ エラー: " + String(err));
    } finally {
      setIsSwitching(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`「${name}」を削除しますか？トーク履歴も消えます`)) {
      onDelete(id);
    }
  };

  const handleEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onEdit(id);
  };

  return (
    <div className="h-dvh w-full overflow-y-auto">
      <div className="flex items-start justify-center p-4">
        <div className="w-full max-w-lg py-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-balance text-text">
              恋AI
            </h1>
            <p className="mt-2 text-sm text-text-muted text-pretty">
              キャラクターを選んでトークを始めましょう
            </p>
          </div>

          {/* Character List */}
          <div className="space-y-3">
            {characters.map((char) => (
              <div
                key={char.id}
                onClick={() => onSelect(char.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(char.id); }}
                className="w-full flex items-center gap-4 p-4 bg-surface rounded-xl border border-border
                           hover:border-accent cursor-pointer overflow-hidden
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                           transition-colors duration-150 text-left"
              >
                {/* Avatar */}
                <div className="relative shrink-0 rounded-full bg-accent/20 overflow-hidden" style={{ width: 56, height: 56 }}>
                  {char.config.imageUrl ? (
                    <img
                      src={getImageSrc(char.config.imageUrl)}
                      alt=""
                      className="absolute inset-0 object-cover"
                      style={{ width: 56, height: 56 }}
                    />
                  ) : (
                    <div className="flex items-center justify-center" style={{ width: 56, height: 56 }}>
                      <span className="text-lg font-bold text-accent">
                        {char.config.name.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{char.config.name}</p>
                  <p className="text-xs text-text-dim truncate">{char.config.persona}</p>
                  <p className="text-xs text-text-dim tabular-nums mt-0.5">
                    {char.messages.length > 0
                      ? `${char.messages.length}件のメッセージ`
                      : "トーク履歴なし"
                    }
                  </p>
                </div>

                {/* Actions */}
                <div className="shrink-0 flex gap-1">
                  <button
                    onClick={(e) => handleEdit(e, char.id)}
                    className="p-2 rounded-lg text-text-dim hover:text-text hover:bg-surface-2 transition-colors duration-150"
                    aria-label={`${char.config.name}を編集`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, char.id, char.config.name)}
                    className="p-2 rounded-lg text-text-dim hover:text-red-400 hover:bg-surface-2 transition-colors duration-150"
                    aria-label={`${char.config.name}を削除`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            {characters.length === 0 && (
              <div className="text-center py-12 text-text-dim">
                <p className="text-sm text-pretty">まだキャラクターがいません</p>
                <p className="text-xs mt-1 text-pretty">下のボタンから作成しましょう</p>
              </div>
            )}
          </div>

          {/* New Character Button */}
          <button
            onClick={onNew}
            className="w-full mt-6 rounded-xl bg-accent py-3.5 text-sm font-semibold text-white
                       hover:bg-accent-hover
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg
                       transition-colors duration-150"
          >
            ＋ 新しいキャラクターを作成
          </button>

          {/* Global Model Selection */}
          <div className="mt-8 bg-surface rounded-2xl border border-border p-4 space-y-2">
            <label htmlFor="model" className="block text-xs font-medium text-text-muted">AIモデル（全キャラ共通）</label>
            <div className="flex gap-2">
              <select
                id="model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isSwitching}
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow duration-150 disabled:opacity-50"
              >
                {models.length === 0 && <option value="">読み込み中...</option>}
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleSwitchModel}
                disabled={!selectedModel || isSwitching}
                className="shrink-0 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-text
                           hover:bg-accent hover:text-white hover:border-accent
                           disabled:opacity-40 disabled:cursor-not-allowed
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                           transition-colors duration-150"
              >
                {isSwitching ? "切替中..." : "切替"}
              </button>
            </div>
            {modelStatus && (
              <p className="text-xs text-text-dim">{modelStatus}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
