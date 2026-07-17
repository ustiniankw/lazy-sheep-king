// tests/crypto_backup.test.mjs — v0.7.0 备份短语 + E2E 加密
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Node < 20 兜底：缺 globalThis.crypto 时注入 webcrypto
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

const {
  generateMnemonic,
  validateMnemonic,
  normalizeMnemonic,
  mnemonicHash,
  mnemonicToKey,
  encryptBlob,
  decryptBlob,
  encryptWithMnemonic,
  decryptWithMnemonic,
  deriveVaultId,
  deriveVaultToken,
  DEFAULT_WORD_COUNT,
} = await import('../lib/crypto_backup.js');
const { WORDLIST_SET, WORDLIST_SIZE } = await import('../lib/wordlist.js');

describe('generateMnemonic', () => {
  it('默认生成 14 个词，且全部在词表内', () => {
    const m = generateMnemonic();
    const words = m.split(' ');
    assert.equal(words.length, DEFAULT_WORD_COUNT);
    assert.equal(words.length, 14);
    assert.ok(words.every((w) => WORDLIST_SET.has(w)), '所有词都应在词表内');
    assert.ok(validateMnemonic(m), 'validateMnemonic 应通过');
  });

  it('支持自定义词数', () => {
    const m = generateMnemonic(20);
    assert.equal(m.split(' ').length, 20);
    assert.ok(validateMnemonic(m, 20));
  });

  it('两次生成的短语大概率不同（随机性）', () => {
    const a = generateMnemonic();
    const b = generateMnemonic();
    assert.notEqual(a, b);
  });
});

describe('validateMnemonic', () => {
  it('词数不对时返回 false', () => {
    const m = generateMnemonic(); // 14 词
    const short = m.split(' ').slice(0, 10).join(' ');
    assert.equal(validateMnemonic(short), false);
  });

  it('存在词表外单词时返回 false', () => {
    const words = generateMnemonic().split(' ');
    words[3] = 'zzzznotaword';
    assert.equal(validateMnemonic(words.join(' ')), false);
  });

  it('大小写 / 多余空格会被归一化后仍校验通过', () => {
    const m = generateMnemonic();
    const messy = `   ${m.toUpperCase().replace(/ /g, '   ')}  `;
    assert.equal(validateMnemonic(messy), true);
    assert.equal(normalizeMnemonic(messy), m);
  });

  it('非字符串输入返回 false', () => {
    assert.equal(validateMnemonic(null), false);
    assert.equal(validateMnemonic(123), false);
    assert.equal(validateMnemonic(undefined), false);
  });
});

describe('encrypt/decrypt roundtrip', () => {
  it('对象加密后可原样解密（roundtrip）', async () => {
    const mnemonic = generateMnemonic();
    const key = await mnemonicToKey(mnemonic);
    const data = { tasks: [{ id: 1, goal: '写周报' }], pets: { level: 3 }, note: '你好 🐑' };
    const blob = await encryptBlob(data, key);
    assert.equal(blob.alg, 'AES-GCM');
    assert.ok(typeof blob.iv === 'string' && blob.iv.length > 0);
    assert.ok(typeof blob.ct === 'string' && blob.ct.length > 0);
    const text = await decryptBlob(blob, key);
    assert.deepEqual(JSON.parse(text), data);
  });

  it('便捷方法 encryptWithMnemonic / decryptWithMnemonic 往返一致', async () => {
    const mnemonic = generateMnemonic();
    const data = { hello: 'world', n: 42, arr: [1, 2, 3] };
    const blob = await encryptWithMnemonic(data, mnemonic);
    const restored = await decryptWithMnemonic(blob, mnemonic);
    assert.deepEqual(restored, data);
  });

  it('每次加密的 IV / 密文不同（随机 12-byte IV）', async () => {
    const key = await mnemonicToKey(generateMnemonic());
    const b1 = await encryptBlob('same plaintext', key);
    const b2 = await encryptBlob('same plaintext', key);
    assert.notEqual(b1.iv, b2.iv);
    assert.notEqual(b1.ct, b2.ct);
  });
});

describe('wrong key fails', () => {
  it('用错误短语派生的密钥解密应失败', async () => {
    const good = generateMnemonic();
    let bad = generateMnemonic();
    while (bad === good) bad = generateMnemonic();
    const keyGood = await mnemonicToKey(good);
    const keyBad = await mnemonicToKey(bad);
    const blob = await encryptBlob({ secret: 'top' }, keyGood);
    await assert.rejects(() => decryptBlob(blob, keyBad));
  });

  it('密文被篡改后解密应失败（GCM 完整性校验）', async () => {
    const key = await mnemonicToKey(generateMnemonic());
    const blob = await encryptBlob({ secret: 'top' }, key);
    // 翻转密文中的一个字符
    const tampered = { ...blob, ct: blob.ct.slice(0, -2) + (blob.ct.slice(-2) === 'AA' ? 'BB' : 'AA') };
    await assert.rejects(() => decryptBlob(tampered, key));
  });
});

describe('mnemonicHash', () => {
  it('相同短语得到相同 hash（稳定），且为 64 位 hex', async () => {
    const m = generateMnemonic();
    const h1 = await mnemonicHash(m);
    const h2 = await mnemonicHash(m);
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
  });

  it('大小写 / 空格归一化后 hash 一致', async () => {
    const m = generateMnemonic();
    const h1 = await mnemonicHash(m);
    const h2 = await mnemonicHash(`  ${m.toUpperCase()}  `);
    assert.equal(h1, h2);
  });

  it('不同短语得到不同 hash', async () => {
    const a = generateMnemonic();
    let b = generateMnemonic();
    while (b === a) b = generateMnemonic();
    assert.notEqual(await mnemonicHash(a), await mnemonicHash(b));
  });
});

describe('wordlist', () => {
  it('词表为 512 且无重复', () => {
    assert.equal(WORDLIST_SIZE, 512);
    assert.equal(WORDLIST_SET.size, 512);
  });
});

describe('v0.8 云同步 vault 派生', () => {
  it('deriveVaultId 稳定、32 位 hex', async () => {
    const m = generateMnemonic();
    const a = await deriveVaultId(m);
    const b = await deriveVaultId(m);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{32}$/);
  });

  it('deriveVaultToken 稳定、32 位 hex', async () => {
    const m = generateMnemonic();
    const a = await deriveVaultToken(m);
    const b = await deriveVaultToken(m);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{32}$/);
  });

  it('vaultId 与 vaultToken 不相等（不同盐）', async () => {
    const m = generateMnemonic();
    assert.notEqual(await deriveVaultId(m), await deriveVaultToken(m));
  });

  it('不同短语派生不同 vaultId', async () => {
    const a = generateMnemonic();
    let b = generateMnemonic();
    while (b === a) b = generateMnemonic();
    assert.notEqual(await deriveVaultId(a), await deriveVaultId(b));
  });

  it('大小写 / 空格归一化后派生一致', async () => {
    const m = generateMnemonic();
    assert.equal(await deriveVaultId(m), await deriveVaultId(`  ${m.toUpperCase()}  `));
  });
});
