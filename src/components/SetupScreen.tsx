"use client";

import { useState, useEffect, type FormEvent } from "react";
import type { HeroineConfig } from "@/app/page";
import { open } from "@tauri-apps/plugin-dialog";
import { getImageSrc } from "@/lib/utils";

interface ExpressionEntry {
  label: string;
  imageUrl: string;
}

interface SetupScreenProps {
  onSave: (config: HeroineConfig) => void;
  onBack: () => void;
  savedConfig?: HeroineConfig | null;
  isEditing?: boolean;
}

export default function SetupScreen({ onSave, onBack, savedConfig, isEditing }: SetupScreenProps) {
  const [name, setName] = useState(savedConfig?.name ?? "");
  const [persona, setPersona] = useState(savedConfig?.persona ?? "");
  const [tone, setTone] = useState(savedConfig?.tone ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(savedConfig?.imageUrl ?? null);
  const [expressions, setExpressions] = useState<ExpressionEntry[]>(() => {
    if (savedConfig?.expressions) {
      return Object.entries(savedConfig.expressions).map(([label, url]) => ({ label, imageUrl: url }));
    }
    return [];
  });

  const [pendingExprIndex, setPendingExprIndex] = useState<number | null>(null);

  useEffect(() => {
    if (savedConfig) {
      setName(savedConfig.name);
      setPersona(savedConfig.persona);
      setTone(savedConfig.tone);
      setImageUrl(savedConfig.imageUrl);
      if (savedConfig.expressions) {
        setExpressions(
          Object.entries(savedConfig.expressions).map(([label, url]) => ({ label, imageUrl: url }))
        );
      }
    }
  }, [savedConfig]);

  const handleImageSelect = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      });
      if (selected && typeof selected === 'string') {
        setImageUrl(selected);
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handleExprImageSelect = async () => {
    if (pendingExprIndex === null) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      });
      if (selected && typeof selected === 'string') {
        setExpressions((prev) => {
          const next = [...prev];
          next[pendingExprIndex] = { ...next[pendingExprIndex], imageUrl: selected };
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    } finally {
      setPendingExprIndex(null);
    }
  };


  const addExpression = () => {
    setExpressions((prev) => [...prev, { label: "", imageUrl: "" }]);
  };

  const removeExpression = (index: number) => {
    setExpressions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateExprLabel = (index: number, label: string) => {
    setExpressions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], label };
      return next;
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !persona.trim() || !tone.trim()) return;

    const expressionMap: Record<string, string> = {};
    for (const expr of expressions) {
      if (expr.label.trim() && expr.imageUrl) {
        expressionMap[expr.label.trim()] = expr.imageUrl;
      }
    }

    onSave({
      name: name.trim(),
      persona: persona.trim(),
      tone: tone.trim(),
      imageUrl,
      expressions: expressionMap,
    });
  };

  const isValid = name.trim() && persona.trim() && tone.trim();

  return (
    <div className="h-dvh w-full overflow-y-auto relative">
      <div className="flex items-start justify-center p-4">
        <div className="w-full max-w-lg py-8">
          {/* Header */}
          <div className="text-center mb-8">
            <button
              type="button"
              onClick={onBack}
              className="absolute left-4 top-4 p-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-2
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                         transition-colors duration-150"
              aria-label="戻る"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-3xl font-bold tracking-tight text-balance text-text">
              {isEditing ? "キャラクター編集" : "新しいキャラクター"}
            </h1>
            <p className="mt-2 text-sm text-text-muted text-pretty">
              {isEditing ? "設定を変更して保存しましょう" : "あなただけのキャラクターを作成しましょう"}
            </p>
          </div>

          {/* Form Card */}
          <form onSubmit={handleSubmit} className="bg-surface rounded-2xl border border-border p-6 space-y-5">
            {/* Image Upload */}
            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={handleImageSelect}
                className="relative size-28 rounded-full border-2 border-dashed border-border-light overflow-hidden
                           hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                           transition-colors duration-150"
                aria-label="デフォルト立ち絵画像を選択"
              >
                {imageUrl ? (
                  <img src={getImageSrc(imageUrl)} alt="ヒロイン立ち絵プレビュー" className="size-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center justify-center size-full text-text-dim">
                    <svg xmlns="http://www.w3.org/2000/svg" className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <span className="text-xs mt-1">立ち絵</span>
                  </div>
                )}
              </button>
              <p className="text-xs text-text-dim">デフォルト立ち絵（任意）</p>
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-sm font-medium text-text-muted">名前</label>
              <input
                id="name" type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：桜井 美咲"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow duration-150"
              />
            </div>

            {/* Persona */}
            <div className="space-y-1.5">
              <label htmlFor="persona" className="block text-sm font-medium text-text-muted">性格（ペルソナ）</label>
              <textarea
                id="persona" value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="例：明るくて元気、少しドジだけど一生懸命な大学生。"
                rows={3}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-text placeholder:text-text-dim resize-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow duration-150"
              />
            </div>

            {/* Tone */}
            <div className="space-y-1.5">
              <label htmlFor="tone" className="block text-sm font-medium text-text-muted">口調</label>
              <textarea
                id="tone" value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder='例：「〜だよ！」「〜かな？」など、柔らかい女性語。'
                rows={2}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-text placeholder:text-text-dim resize-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow duration-150"
              />
            </div>

            {/* Expression Variants */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-text-muted">表情差分</label>
                <button
                  type="button"
                  onClick={addExpression}
                  className="text-xs text-accent hover:text-accent-hover transition-colors duration-150"
                >
                  ＋ 差分を追加
                </button>
              </div>

              {expressions.length === 0 && (
                <p className="text-xs text-text-dim">差分画像はまだ追加されていません</p>
              )}


              <div className="space-y-3">
                {expressions.map((expr, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
                    {/* Label + Remove */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={expr.label}
                        onChange={(e) => updateExprLabel(i, e.target.value)}
                        placeholder="ラベル（例: 照れ, 怒り, 笑顔）"
                        className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow duration-150"
                      />
                      <button
                        type="button"
                        onClick={() => removeExpression(i)}
                        className="shrink-0 p-1.5 rounded-lg text-text-dim hover:text-red-400 hover:bg-surface transition-colors duration-150"
                        aria-label={`差分${i + 1}を削除`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Image upload area */}
                    <button
                      type="button"
                      onClick={() => {
                        setPendingExprIndex(i);
                        // handleExprImageSelect is async but we don't need to await it here
                        handleExprImageSelect();
                      }}
                      className="w-full rounded-lg border border-dashed border-border-light overflow-hidden
                                 hover:border-accent transition-colors duration-150"
                      aria-label={`差分${i + 1}の画像を選択`}
                    >
                      {expr.imageUrl ? (
                        <img src={getImageSrc(expr.imageUrl)} alt="" className="w-full h-24 object-contain bg-bg" />
                      ) : (
                        <div className="flex items-center justify-center gap-2 py-4 text-text-dim">
                          <svg xmlns="http://www.w3.org/2000/svg" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                          </svg>
                          <span className="text-xs">クリックして画像を選択</span>
                        </div>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!isValid}
              className="w-full rounded-lg bg-accent py-3 text-sm font-semibold text-white
                         hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface
                         transition-colors duration-150"
            >
              {isEditing ? "保存する" : "作成する"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
