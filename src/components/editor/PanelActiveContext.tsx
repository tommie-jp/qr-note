"use client";

import { createContext } from "react";

// タブパネル (MemoPanel) が「この中身はいま表向きに見えているか」を子へ伝える。
//
// MemoPanel は開いたタブを unmount せず hidden で保持する (編集中の入力を守るため)。
// だが編集ボタンは下部バーへ portal する — portal は hidden の枠の外へ出るので、
// 別タブへ切り替えても hidden にならず、表示タブなのに編集ボタンが残ってしまう。
// そこで「アクティブなタブか」をこの context で配り、MemoEditorInner は
// アクティブなときだけ portal する。
//
// 既定は true — MemoPanel を通らない場所 (/edit ページ) では常にアクティブ扱いで
// よい (タブが無く、エディタは常に表向き)。
export const PanelActiveContext = createContext(true);
