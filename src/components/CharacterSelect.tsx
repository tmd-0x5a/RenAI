"use client";

import { useState, useEffect } from "react";
import type { CharacterData } from "@/app/page";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

  const [engineMode, setEngineMode] = useState<"cpu" | "gpu">("cpu");
  const [isInstalling, setIsInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState<{status: string; progress: number} | null>(null);
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [deletingCharacter, setDeletingCharacter] = useState<{ id: string; name: string } | null>(null);

  // 初回ロードで利用可能なモデル一覧を取得
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

    const savedEngine = localStorage.getItem("ai-renai-engine-mode");
    if (savedEngine === "gpu") {
      setEngineMode("gpu");
    }
  }, []);

  const handleSwitchModel = async () => {
    if (!selectedModel || isSwitching) return;
    setIsSwitching(true);
    setModelStatus("モデルを切り替え中...");
    try {
      await invoke<string>("switch_model", { modelName: selectedModel, useGpu: engineMode === "gpu" });
      localStorage.setItem("ai-renai-model", selectedModel);
      setModelStatus(`✓ 切替完了 (${engineMode === "gpu" ? "GPU" : "CPU"} モード)`);
      setTimeout(() => setModelStatus(""), 4000);
    } catch (err) {
      console.error("Failed to switch model:", err);
      setModelStatus("✗ エラー: " + String(err));
    } finally {
      setIsSwitching(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setDeletingCharacter({ id, name });
  };

  const executeDelete = () => {
    if (deletingCharacter) {
      onDelete(deletingCharacter.id);
      setDeletingCharacter(null);
    }
  };

  const handleEdit = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onEdit(id);
  };

  const askInstallGpu = () => {
    if (isInstalling) return;
    setShowLicenseModal(true);
  };

  const executeInstallGpu = async () => {
    setShowLicenseModal(false);
    if (isInstalling) return;

    setIsInstalling(true);
    setInstallStatus("ダウンロード中... (しばらくお待ちください)");
    setDownloadProgress(null);
    let unlisten: (() => void) | null = null;
    
    try {
      unlisten = await listen<{ status: string; progress: number }>("download-progress", (event) => {
        setDownloadProgress(event.payload);
      });

      await invoke("download_gpu_engine");
      setInstallStatus("✓ インストール成功！");
      setEngineMode("gpu");
      localStorage.setItem("ai-renai-engine-mode", "gpu");
      
      // Notify switch model required
      setModelStatus("💡 新しい推論エンジンが追加されました。「切替」ボタンを押して適用してください。");
      setTimeout(() => setInstallStatus(""), 5000);
    } catch (err) {
      console.error(err);
      setInstallStatus("✗ エラー: " + String(err));
    } finally {
      setIsInstalling(false);
      setDownloadProgress(null);
      if (unlisten) unlisten();
    }
  };

  const toggleEngineMode = () => {
    const newMode = engineMode === "cpu" ? "gpu" : "cpu";
    setEngineMode(newMode);
    localStorage.setItem("ai-renai-engine-mode", newMode);
    setModelStatus(`💡 ${newMode.toUpperCase()} モードに変更しました。「切替」ボタンを押して適用してください。`);
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
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, char.id, char.config.name)}
                    className="p-2 rounded-lg text-text-dim hover:text-red-400 hover:bg-surface-2 transition-colors duration-150"
                    aria-label={`${char.config.name}を削除`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

          <div className="flex flex-col w-full">
            {/* 物理的なスペーサー（キャッシュ対策で確実に24px空ける） */}
            <div style={{ height: '32px', width: '100%', flexShrink: 0 }} aria-hidden="true" />

            {/* New Character Button */}
            <button
              onClick={onNew}
              className="w-full rounded-xl bg-accent py-3.5 text-sm font-semibold text-white
                         hover:bg-accent-hover
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg
                         transition-colors duration-150 shadow-md"
            >
              ＋ 新しいキャラクターを作成
            </button>

            {/* 物理的なスペーサー */}
            <div style={{ height: '28px', width: '100%', flexShrink: 0 }} aria-hidden="true" />

            {/* Global Model Selection */}
            <div className="bg-surface rounded-2xl border border-border p-4 space-y-2">
              <label htmlFor="model" className="block text-xs font-medium text-text-muted mb-1">AIモデル（全キャラ共通）</label>
              <div className="flex gap-2 items-center w-full">
                <div className="min-w-0 flex-1">
                  <select
                    id="model"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={isSwitching}
                    className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow duration-150 disabled:opacity-50"
                  >
                    {models.length === 0 && <option value="">読み込み中...</option>}
                    {models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchModel}
                  disabled={!selectedModel || isSwitching}
                  className="shrink-0 whitespace-nowrap rounded-lg bg-surface-2 border border-border px-4 py-2 text-sm text-text
                             hover:bg-accent hover:text-white hover:border-accent
                             disabled:opacity-40 disabled:cursor-not-allowed
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                             transition-colors duration-150"
                >
                  {isSwitching ? "切替中..." : "切替"}
                </button>
              </div>
              {modelStatus && (
                <p className="text-xs font-semibold text-accent animate-pulse mt-2">{modelStatus}</p>
              )}
            </div>

            {/* 物理的なスペーサー */}
            <div style={{ height: '28px', width: '100%', flexShrink: 0 }} aria-hidden="true" />

            {/* Engine Settings (GPU Download) */}
            <div className="bg-surface rounded-2xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-text-muted">推論エンジン (直接実行)</label>
                <p className="text-[10px] text-text-dim mt-0.5 max-w-[200px] text-pretty">
                  OSやGPUの有無を自動判定し、最適なエンジンを取得・使用して処理速度を向上させます。
                </p>
              </div>
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={toggleEngineMode}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${engineMode === "gpu" ? "bg-accent" : "bg-surface-2"}`}
                  role="switch"
                  aria-checked={engineMode === "gpu"}
                >
                  <span className={`inline-block size-4 transform rounded-full bg-white transition-transform duration-200 ${engineMode === "gpu" ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-4 border-t border-border-light mt-2">
              <details className="w-full">
                <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text transition-colors text-center w-full py-2">
                  詳細設定 / エンジンの再セットアップ
                </summary>
                <div className="pt-3 flex flex-col gap-3">
                  {!isInstalling && (
                    <button
                      type="button"
                      onClick={askInstallGpu}
                      disabled={isInstalling}
                      className="w-full rounded-lg border px-3 py-2.5 text-sm font-medium
                                 transition-colors duration-150 flex items-center justify-center gap-2
                                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                                 bg-surface-2 border-border-light text-text hover:bg-accent/10 hover:border-accent disabled:opacity-40 disabled:cursor-wait"
                    >
                      <svg style={{ width: 20, height: 20, flexShrink: 0 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      <span>推論エンジンを自動取得 / 再インストール</span>
                    </button>
                  )}
                  
                  {isInstalling && (
                    <div className="w-full rounded-lg border px-3 py-2.5 text-sm font-medium border-border-light bg-surface-2 flex items-center justify-center gap-2">
                      <div className="flex flex-col w-full px-1 gap-1.5 my-1">
                        <div className="flex items-center justify-center gap-2">
                          <svg style={{ width: 20, height: 20, flexShrink: 0 }} className="animate-spin text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <span className="font-semibold">{downloadProgress ? downloadProgress.status : "準備中..."}</span>
                        </div>
                        {downloadProgress && (
                          <div className="flex items-center w-full gap-2">
                            <div className="h-2 flex-1 bg-surface-3 rounded-full overflow-hidden border border-border">
                              <div
                                className="h-full bg-accent transition-all duration-300 ease-out"
                                style={{ width: `${Math.max(0, Math.min(100, downloadProgress.progress))}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-text-dim w-8 text-right shrink-0">
                              {Math.round(downloadProgress.progress)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </details>
              
              <div className="flex flex-col gap-1 items-center">
                {installStatus && (
                  <div className="w-full mt-2">
                    <p className={`text-xs font-medium text-center ${installStatus.startsWith("エラー") ? "text-red-400" : "text-text-dim"}`}>
                      {installStatus}
                    </p>
                  </div>
                )}
                
                {(!installStatus || !installStatus.startsWith("エラー")) && (
                  <a href="https://github.com/ggerganov/llama.cpp/releases/latest" 
                     target="_blank" 
                     rel="noopener noreferrer" 
                     className="text-[10px] text-text-muted hover:text-accent hover:underline transition-colors mt-1">
                    🌐 ダウンロード元: ggerganov/llama.cpp (GitHub)
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MIT License Modal */}
      {showLicenseModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowLicenseModal(false)}
        >
          <div 
            className="bg-surface rounded-2xl border border-border w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border bg-surface-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">推論エンジンのインストール確認</h3>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-4 text-xs text-text-muted leading-relaxed">
              <p>
                OSに適合した推論エンジン (llama.cpp) の実行ファイルを自動取得して初期設定を行います。<br/>
                この機能はオープンソースソフトウェアである <strong>llama.cpp</strong> を利用するため、本アプリの利用にあたり以下の「MIT License」規約に同意する必要があります。
              </p>
              
              <div className="bg-surface-2 p-3 rounded-lg border border-border-light font-mono text-[10px] whitespace-pre-wrap select-text max-h-48 overflow-y-auto">
{`MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`}
              </div>
            </div>

            <div className="p-4 border-t border-border bg-surface-2 flex gap-3 justify-center items-center">
              <button
                onClick={executeInstallGpu}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-accent hover:bg-accent-hover text-white shadow-md transition-colors"
                autoFocus
              >
                規約に同意してインストール
              </button>
              <button
                onClick={() => setShowLicenseModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-surface hover:bg-surface-3 border border-border transition-colors text-text"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingCharacter && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setDeletingCharacter(null)}
          role="alertdialog"
          aria-modal="true"
        >
          <div 
            className="bg-surface-2 rounded-2xl border border-border w-full max-w-[400px] shadow-2xl flex flex-col items-center text-center p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-6">
              キャラクターの削除
            </h3>
            
            <div className="space-y-4 mb-8 text-base">
              <p className="text-gray-100 leading-relaxed">
                「<span className="font-bold text-white break-all">{deletingCharacter.name}</span>」を削除してもよろしいですか？
              </p>
              <p className="text-[#ff6b6b] font-bold text-sm leading-relaxed">
                この操作は取り消せません。<br/>
                これまでのトーク履歴もすべて消去されます。
              </p>
            </div>
            
            <div className="flex gap-4 w-full justify-center">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  executeDelete();
                }}
                className="flex-1 min-w-[120px] px-6 py-3 rounded-lg text-base font-bold text-white bg-red-500 hover:bg-red-600 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-surface-2 cursor-pointer"
              >
                削除する
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeletingCharacter(null);
                }}
                className="flex-1 min-w-[120px] px-6 py-3 rounded-lg text-base font-bold text-text bg-transparent border border-border hover:bg-surface-3 transition-colors focus:outline-none focus:ring-2 focus:ring-border focus:ring-offset-2 focus:ring-offset-surface-2 cursor-pointer"
                autoFocus
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
);
}
