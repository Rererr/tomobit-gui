import test from "node:test";
import assert from "node:assert/strict";
import {
  commandFromFence,
  isRunnable,
  isRunnableLanguage,
  runOutputIsEmpty,
  runResultLabel,
  workingDirLabel,
} from "./commandBlock.ts";
import type { main } from "../wailsjs/go/models";

const run = (over: Partial<main.CommandRun> = {}): main.CommandRun =>
  ({
    command: "echo hi",
    working_dir: "",
    stdout: "",
    stderr: "",
    exit_code: 0,
    timed_out: false,
    truncated: false,
    duration_ms: 300,
    ...over,
  }) as main.CommandRun;

test("シェルと申告されたフェンスにだけボタンを出す", () => {
  assert.equal(isRunnableLanguage("language-sh"), true);
  assert.equal(isRunnableLanguage("language-bash"), true);
  assert.equal(isRunnableLanguage("language-zsh"), true);
  assert.equal(isRunnableLanguage("language-BASH"), true);
  // 他の言語のコードにボタンを出すのは、こちらが意味を付け足すことになる
  assert.equal(isRunnableLanguage("language-go"), false);
  assert.equal(isRunnableLanguage("language-json"), false);
  // ADR-0007 Decision 2 が名指ししていない別名は広げない
  assert.equal(isRunnableLanguage("language-shell"), false);
  assert.equal(isRunnableLanguage("language-console"), false);
});

test("言語指定の無いフェンスにはボタンを出さない", () => {
  assert.equal(isRunnableLanguage(undefined), false);
  assert.equal(isRunnableLanguage(""), false);
  assert.equal(isRunnableLanguage("some-other-class"), false);
});

test("className に他のクラスが混ざっていても言語を拾う", () => {
  assert.equal(isRunnableLanguage("hljs language-sh extra"), true);
});

test("フェンスの中身は末尾の改行だけ落として、他は何も加工しない", () => {
  assert.equal(commandFromFence("npm test\n"), "npm test");
  assert.equal(commandFromFence("npm test\n\n\n"), "npm test");
  // 複数行はそのまま（確認の帯に出す全文と、走る文字列を食い違わせない）
  assert.equal(commandFromFence("cd frontend\nnpm test\n"), "cd frontend\nnpm test");
  // 行頭の $ もコメントも剥がさない — 剥がすと見せた通りに走らなくなる
  assert.equal(commandFromFence("$ npm test"), "$ npm test");
  assert.equal(commandFromFence("  npm test  "), "  npm test  ");
});

test("中身が空白だけのフェンスにはボタンを出さない", () => {
  assert.equal(isRunnable("language-sh", "npm test\n"), true);
  assert.equal(isRunnable("language-sh", "   \n\n"), false);
  assert.equal(isRunnable("language-go", "npm test"), false);
});

test("結果の見出しは、名乗れる終わり方だけ終了コードを名乗る", () => {
  assert.equal(runResultLabel(run({ exit_code: 0, duration_ms: 340 })), "終了コード 0 ・ 0.3s");
  assert.equal(runResultLabel(run({ exit_code: 2, duration_ms: 1500 })), "終了コード 2 ・ 1.5s");
  // 時間切れは 0 でも失敗でもなく「終わらなかった」
  assert.equal(
    runResultLabel(run({ exit_code: -1, timed_out: true, duration_ms: 120000 })),
    "時間切れで打ち切った ・ 120.0s",
  );
  // シグナル死などコードを取れない終わり方に、数字を発明しない
  assert.equal(
    runResultLabel(run({ exit_code: -1, duration_ms: 900 })),
    "終了コードを取れないまま終わった ・ 0.9s",
  );
});

test("出力が無かったことは、空欄ではなく事実として扱う", () => {
  assert.equal(runOutputIsEmpty(run()), true);
  assert.equal(runOutputIsEmpty(run({ stdout: "x" })), false);
  assert.equal(runOutputIsEmpty(run({ stderr: "x" })), false);
});

test("未設定の作業ディレクトリに、それらしいパスを発明しない", () => {
  assert.equal(workingDirLabel(""), "作業ディレクトリ未設定（GUIを起動した場所）");
  assert.equal(workingDirLabel("/Users/x/proj"), "/Users/x/proj");
});
