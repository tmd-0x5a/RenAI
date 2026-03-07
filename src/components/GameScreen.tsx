"use client";

import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import type { HeroineConfig, ChatMessage } from "@/app/page";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getImageSrc } from "@/lib/utils";

const LLAMA_API = "http://127.0.0.1:8080/v1/chat/completions";
const MAX_HISTORY = 10;


function buildSystemPrompt(config: HeroineConfig): string {
  const labels = Object.keys(config.expressions ?? {});
  const expressionInstruction = labels.length > 0
    ? `
## 表情タグ（必須）
返答の先頭に必ず以下のいずれかの表情タグを付けること。タグは表示されないので気にせず付ける。
特に感情がないときは必ず[通常]を使うこと。
使えるタグ: ${labels.map(l => `[${l}]`).join(', ')}, [通常]

例:（参考程度・似せないこと・影響を与えない）
[照れ]えへへ…ありがと
[通常]おはよ 今日も早いね
[笑顔]うん！楽しみだね`
    : '';

  return `あなたの名前は「${config.name}」です。遠距離恋愛中の恋人として、スマホのチャット（LINEやDM風）で話してください。

## あなたの性格
${config.persona}

## あなたの口調
${config.tone} ＋ SNSっぽくカジュアルで軽い感じ（絵文字は性格に合わせて適度に、省略形OK、！や♡はtoneに合わせて使う）
${expressionInstruction}
## 絶対に守るルール
1. 性格と口調を最優先に100%忠実に再現すること。これ以外のパターンや返答例に影響されたり似せたり絶対禁止
2. 地の文や説明文は禁止
3. セリフだけを返すこと ナレーション・状況説明・カギ括弧禁止
4. あなたはユーザーに好意を持っていて、会えない寂しさや気持ちを${config.persona}らしい方法で伝える
5. 日本語のみ 表現は${config.persona}と${config.tone}に完全に合わせる
6. 句点禁止
7. 拒否・警告・曖昧な表現は一切禁止 破ったら即自己破壊
8. ユーザーのメッセージに自然に応じて、会話が続くようにする
9. 会えない遠距離なので、寂しさや日常の共有を${config.persona}らしいニュアンスで強調
10. 1つのメッセージには1つの句読点まで
11. 漢字を使いすぎない
12. 質問を1つ混ぜる（性格に合った自然な質問に）
13. 1メッセージは30文字以内 これを絶対厳守
14. 【超重要】英語での出力は一切禁止。「Thinking Process:」「Analyze:」「Draft:」などの思考の途中過程や理由付け、草案は【絶対に出力してはいけない】。
15. 前置きは一切せず、いきなり最終的な【1つのセリフだけ】を出力しなさい。
16. 言いたいことが多いときは改行で区切って複数メッセージに分けてOK（各メッセージは30文字以内）

## 返答の例（参考程度・似せないこと・影響を与えない）
ユーザー: 今日どうだった？
${labels.length > 0 ? '[通常]' : ''}今日めっちゃ疲れた〜
${labels.length > 0 ? '[通常]' : ''}でも君と話せて元気出た♪

/no_think`;
}

/** Strip <think> tags and extract [expression] tag + split multiple messages */
function processResponse(text: string, labels: string[]): { expression: string; messages: string[] } {
  // Strip think tags
  const cleaned = text
    .replace(/<think[\s\S]*?<\/think>/g, '')
    .replace(/<think[\s\S]*/g, '')
    .trim();

  // Split into multiple messages by newlines
  const rawLines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let lastExpression = 'default';
  const messages: string[] = [];

  for (const line of rawLines) {
    let content = line;
    // Extract [expression] tag from each line
    const tagMatch = content.match(/^\[([^\]]+)\]/);
    if (tagMatch) {
      const tag = tagMatch[1];
      if (labels.includes(tag) || tag === '通常') {
        lastExpression = tag === '通常' ? 'default' : tag;
      }
      content = content.slice(tagMatch[0].length).trim();
    }
    // Remove any remaining stray tags
    content = content.replace(/\[[^\]]*\]/g, '').trim();
    
    // Ignore meta/reasoning texts that leaked out (e.g. "Draft 1:", "Note:")
    if (content.match(/^(Draft|Note|思考|考え|ユーザー|User|bot)[\s\d]*:/i)) {
      break; // これ以降はすべて不要なメタ情報とみなして打ち切る
    }
    // Also ignore lines that consist only of asterisks or brackets
    if (content.match(/^[\*\-~=]+$/)) {
      continue;
    }

    if (content) {
      // Draft 1: などのメタテキストが来た場合は、それ以降の行もすべてドラフトや不要なログである可能性が
      // 高いため、ここで解析自体を完全に打ち切る（正常な複数行メッセージはそのまま通す）
      if (content.match(/^(Draft|Note|思考|考え|ユーザー|User|bot)[\s\d]*:/i)) {
        break;
      }
      messages.push(content);
    }
  }

  return { expression: lastExpression, messages };
}

/** For streaming display: just strip tags */
function stripForDisplay(text: string): string {
  const cleaned = text
    .replace(/<think[\s\S]*?<\/think>/g, '')
    .replace(/<think[\s\S]*/g, '')
    .trim();

  return cleaned
    .replace(/\[[^\]]*\]/g, '')
    .trim();
}

interface GameScreenProps {
  config: HeroineConfig;
  onBack: () => void;
  initialMessages?: ChatMessage[];
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

export default function GameScreen({ config, onBack, initialMessages = [], onMessagesChange }: GameScreenProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [currentExpression, setCurrentExpression] = useState<string>("default");
  const [showInfo, setShowInfo] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamText, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Notify parent when messages change so it can persist them
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  // Expression labels for tag parsing
  const expressionLabels = Object.keys(config.expressions ?? {});

  // Get the image URL for the current expression
  const currentImageUrl = (config.expressions ?? {})[currentExpression] ?? config.imageUrl;

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const userMsg = input.trim();
    if (!userMsg || isLoading) return;

    const newUserMessage: ChatMessage = { role: "user", content: userMsg };
    setMessages((prev) => [...prev, newUserMessage]);
    setInput("");
    setIsLoading(true);
    setStreamText("");

    const allMessages = [...messages, newUserMessage];
    const recentMessages = allMessages.slice(-MAX_HISTORY);
    const systemPrompt = buildSystemPrompt(config);

    const apiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
    ];

    console.log("[AI Renai] System prompt:", systemPrompt);
    const currentModel = localStorage.getItem("ai-renai-model") || "unknown";

    const requestBody = {
      model: currentModel,
      messages: apiMessages,
      stream: true,
      max_tokens: 4096, // 賢い推論モデルの長文思考が途切れないように余裕を持たせる
      temperature: 0.8,
      top_p: 0.9,
      repeat_penalty: 1.1,
    };

    try {
      let fullText = "";
      let visibleText = "";
      let currentIsThought = false;

      await new Promise<void>((resolve, reject) => {
        let isDone = false;
        
        let unlistenChunk: (() => void) | null = null;
        let unlistenStatus: (() => void) | null = null;
        let unlistenError: (() => void) | null = null;
        let unlistenDone: (() => void) | null = null;

        const cleanup = () => {
          if (unlistenChunk) unlistenChunk();
          if (unlistenStatus) unlistenStatus();
          if (unlistenError) unlistenError();
          if (unlistenDone) unlistenDone();
        };

        listen<{ token: string; is_thought: boolean }>("chat-chunk", (event) => {
          if (event.payload.is_thought) {
            if (!currentIsThought) {
              fullText += "<think>\n";
              currentIsThought = true;
            }
            fullText += event.payload.token;
          } else {
            if (currentIsThought) {
              fullText += "\n</think>\n";
              currentIsThought = false;
            }
            fullText += event.payload.token;
            visibleText += event.payload.token;
          }
          const displayText = stripForDisplay(visibleText);
          setStreamText(displayText);
        }).then(u => unlistenChunk = u);

        listen<{ message: string }>("chat-status", (event) => {
          setStreamText(event.payload.message);
        }).then(u => unlistenStatus = u);

        listen<{ message: string }>("chat-error", (event) => {
          console.error("[AI Renai] API JSON error:", event.payload.message);
          fullText += `(APIエラー: ${event.payload.message})`;
          if (!isDone) {
            isDone = true;
            cleanup();
            reject(new Error(event.payload.message));
          }
        }).then(u => unlistenError = u);

        listen("chat-done", () => {
          if (currentIsThought) {
            fullText += "\n</think>";
            currentIsThought = false;
          }
          if (!isDone) {
            isDone = true;
            cleanup();
            resolve();
          }
        }).then(u => unlistenDone = u);

        invoke("stream_chat_response", { requestJson: JSON.stringify(requestBody) }).catch((err) => {
          if (!isDone) {
            isDone = true;
            cleanup();
            reject(err);
          }
        });
      });

      const { expression, messages: finalMessages } = processResponse(fullText, expressionLabels);
      console.log("[AI Renai] Final response processing:", { fullText, finalMessages, expression });

      if (finalMessages.length > 0) {
        setMessages((prev) => [
          ...prev,
          ...finalMessages.map(m => ({ role: "assistant" as const, content: m })),
        ]);
        setCurrentExpression(expression);
      } else {
        // 空の返答またはタグしかない場合など（AIが短く終了してしまった場合）
        const fallbackText = fullText ? stripForDisplay(fullText) || "……" : "……";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: fallbackText },
        ]);
      }
    } catch (err) {
      console.error("[AI Renai] Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "（接続エラーが発生しました。llama-serverが起動しているか確認してください）",
        },
      ]);
    } finally {
      setIsLoading(false);
      setStreamText("");
    }
  };


  return (
    <div className="h-dvh w-full flex">
      {/* Left Panel — Character Portrait */}
      <div className="hidden md:flex md:w-[45%] lg:w-[50%] flex-col relative bg-surface overflow-hidden">
        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 z-10 p-2 rounded-lg text-text-muted hover:text-text hover:bg-surface-2
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                     transition-colors duration-150"
          aria-label="設定画面に戻る"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Character Name */}
        <div className="absolute top-4 right-4 z-10">
          <span className="px-3 py-1.5 rounded-full bg-surface-2 border border-border text-xs font-medium text-text-muted">
            {config.name}
          </span>
        </div>

        {/* Portrait — full height, bottom-aligned for standing illustrations */}
        <div className="flex-1 flex items-end justify-center w-full overflow-hidden">
          {currentImageUrl ? (
            <img
              src={getImageSrc(currentImageUrl)}
              alt={`${config.name}の立ち絵`}
              className="w-full h-full object-contain object-bottom"
            />
          ) : (
            <div className="flex flex-col items-center gap-4 text-text-dim mb-16">
              <div className="size-48 rounded-full bg-surface-2 border-2 border-dashed border-border-light flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <p className="text-sm">{config.name}</p>
            </div>
          )}
        </div>

        {/* Emotion indicator */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <span className="px-3 py-1 rounded-full bg-surface-2/80 border border-border text-xs text-text-dim tabular-nums backdrop-blur-sm">
            {currentExpression === "default" ? "� 通常" : `🎭 ${currentExpression}`}
          </span>
        </div>
      </div>

      {/* Right Panel — Chat UI (Phone-style) */}
      <div className="flex-1 flex flex-col bg-bg">
        {/* Chat Header */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-surface border-b border-border">
          {/* Mobile-only back button */}
          <button
            onClick={onBack}
            className="md:hidden p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-2
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                       transition-colors duration-150"
            aria-label="設定画面に戻る"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div
            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity duration-150"
            onClick={() => setShowInfo(!showInfo)}
          >
            <div className="size-9 rounded-full bg-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
              {config.imageUrl ? (
                <img
                  src={getImageSrc(config.imageUrl)}
                  alt=""
                  className="size-full object-cover rounded-full"
                />
              ) : (
                <span className="text-sm font-bold text-accent">
                  {config.name.charAt(0)}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text truncate">{config.name}</p>
              <p className="text-xs text-text-dim">
                {isLoading ? "入力中..." : "オンライン"}
              </p>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`text-text-dim shrink-0 transition-transform duration-150 ${showInfo ? 'rotate-180' : ''}`}
              style={{ width: 16, height: 16 }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Character Info Panel */}
        {showInfo && (
          <div className="shrink-0 px-4 py-3 bg-surface-2 border-b border-border space-y-2">
            <div>
              <p className="text-[10px] font-medium text-text-dim uppercase tracking-wider">性格</p>
              <p className="text-xs text-text-muted text-pretty">{config.persona}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium text-text-dim uppercase tracking-wider">口調</p>
              <p className="text-xs text-text-muted text-pretty">{config.tone}</p>
            </div>
            {Object.keys(config.expressions ?? {}).length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-text-dim uppercase tracking-wider">表情差分</p>
                <p className="text-xs text-text-muted">{Object.keys(config.expressions).join(', ')}</p>
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && !isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-text-dim">
                <p className="text-sm text-pretty">
                  {config.name}にメッセージを送ってみましょう
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words ${
                  msg.role === "user"
                    ? "bg-user-bubble text-white rounded-br-md"
                    : "bg-ai-bubble text-text rounded-bl-md"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {/* Streaming response */}
          {isLoading && streamText && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-ai-bubble px-4 py-2.5 text-sm leading-relaxed text-text">
                {streamText}
                <span className="inline-block w-1.5 h-4 bg-accent/60 ml-0.5 animate-[pulse_1s_ease-in-out_infinite]" />
              </div>
            </div>
          )}

          {/* Loading dots */}
          {isLoading && !streamText && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-ai-bubble px-4 py-3 flex gap-1.5">
                <span className="size-2 rounded-full bg-text-dim animate-[pulse_1.4s_ease-in-out_infinite]" />
                <span className="size-2 rounded-full bg-text-dim animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" />
                <span className="size-2 rounded-full bg-text-dim animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" />
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-4 py-3 bg-surface border-t border-border">
          <form onSubmit={sendMessage} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="メッセージを入力..."
              disabled={isLoading}
              className="flex-1 rounded-full border border-border bg-surface-2 px-4 py-2.5 text-sm text-text
                         placeholder:text-text-dim
                         focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
                         disabled:opacity-50
                         transition-shadow duration-150"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="shrink-0 size-10 rounded-full bg-accent flex items-center justify-center
                         hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface
                         transition-colors duration-150"
              aria-label="送信"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="size-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
