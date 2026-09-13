import { expect, test } from "vitest";
import { runAsyncAction, type AsyncActionSetters } from "./useAsyncAction";

// setter の呼ばれた順を 1 本の列に記録する偽物。React の state 更新は
// 同じ tick の中でまとめて反映されるので、確かめたいのは「何をどの順に呼んだか」
function recorder() {
  const calls: string[] = [];
  const setters: AsyncActionSetters = {
    setBusy: (busy) => {
      calls.push(`busy:${busy}`);
    },
    setError: (error) => {
      calls.push(`error:${error}`);
    },
  };
  return { calls, setters };
}

test("成功したら busy を立てて文言を消し、終わったら busy を戻す", async () => {
  // Arrange
  const { calls, setters } = recorder();
  const action = async () => {
    calls.push("action");
  };

  // Act
  await runAsyncAction(action, () => "出ないはず", setters);

  // Assert
  expect(calls).toEqual(["busy:true", "error:null", "action", "busy:false"]);
});

test("失敗したら onError の文言を出してから busy を戻す", async () => {
  // Arrange
  const { calls, setters } = recorder();
  const boom = new Error("壊れた");
  const seen: unknown[] = [];

  // Act
  await runAsyncAction(
    async () => {
      throw boom;
    },
    (cause) => {
      seen.push(cause);
      return "失敗しました";
    },
    setters,
  );

  // Assert
  expect(seen).toEqual([boom]);
  expect(calls).toEqual([
    "busy:true",
    "error:null",
    "error:失敗しました",
    "busy:false",
  ]);
});

test("onError が null を返したら文言は出さないが、busy は戻す", async () => {
  // Arrange
  const { calls, setters } = recorder();

  // Act
  await runAsyncAction(
    async () => {
      throw new Error("取り消し");
    },
    () => null,
    setters,
  );

  // Assert
  expect(calls).toEqual(["busy:true", "error:null", "busy:false"]);
});

test("失敗しても投げない (呼び出し側は void で走らせてよい)", async () => {
  // Arrange
  const { setters } = recorder();

  // Act
  const result = runAsyncAction(
    async () => {
      throw "文字列も投げられる";
    },
    () => "失敗しました",
    setters,
  );

  // Assert
  await expect(result).resolves.toBeUndefined();
});

test("操作は busy を立てた後、同じ tick のうちに走り始める", async () => {
  // Arrange — 同期部分で呼ばれた setter が busy:true と同じ描画にまとまることを前提に、
  // 呼び出し側は操作の頭で他の state (報告・お知らせ) を消している
  const { calls, setters } = recorder();
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Act
  const running = runAsyncAction(
    async () => {
      calls.push("action-start");
      await pending;
    },
    () => null,
    setters,
  );
  const beforeAwait = [...calls];
  release();
  await running;

  // Assert
  expect(beforeAwait).toEqual(["busy:true", "error:null", "action-start"]);
});
