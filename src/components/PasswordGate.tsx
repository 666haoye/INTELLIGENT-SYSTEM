"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

const ACCESS_PASSWORD = "why666";

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [denied, setDenied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!unlocked && !denied) inputRef.current?.focus();
  }, [unlocked, denied]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((inputRef.current?.value ?? "") === ACCESS_PASSWORD) {
      setUnlocked(true);
    } else {
      setDenied(true);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <div
      className="gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
    >
      <div className={`gate-panel${denied ? " gate-panel--denied" : ""}`}>
        <p className="gate-kicker">DEEP LEARNING · ACCESS</p>
        <h1 className="gate-title" id="gate-title">
          深度学习智慧教育系统
        </h1>

        {denied ? (
          <p className="gate-error" role="alert">
            密码错误，禁止访问网站
          </p>
        ) : (
          <form className="gate-form" onSubmit={submit}>
            <label className="gate-label" htmlFor="gate-password">
              请输入访问密码
            </label>
            <input
              ref={inputRef}
              id="gate-password"
              className="gate-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="gate-submit">
              进入系统
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
