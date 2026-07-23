//go:build unix

package main

import "syscall"

// oNoFollow は open(2) の O_NOFOLLOW (S-1)。スクロールバックの書き込み先が
// シンボリックリンクだった場合に開かず失敗させ、機微の平文を .tomobit の外へ
// 誘導される経路を塞ぐ。unix (darwin/linux/bsd) でのみ意味を持つ。
const oNoFollow = syscall.O_NOFOLLOW
