//go:build !unix

package main

// oNoFollow は unix 以外 (windows 等) では O_NOFOLLOW が無いため no-op の 0。
// OpenFile のフラグに OR しても挙動は変わらない — S-1 のシンボリックリンク
// 防御は unix のみで効き、他プラットフォームでは素の追記に戻る。
const oNoFollow = 0
