import { DeviceConnection, openInBrowser } from './device-auth.mjs';
import { ConnectionError } from './connection.mjs';
const connection=new DeviceConnection(process.env,{host:'Codex',open:openInBrowser});
try {
  const state=await connection.connect();
  if(state.status==='connected') { console.log('100x 已连接，沿用本机已保存的凭据。'); process.exit(0); }
  console.log('100x · 请在网页核对连接码：'+state.user_code);
  console.log(state.verification_uri);
  while(Date.parse(state.expires_at)>Date.now()) {
    await new Promise(resolve=>setTimeout(resolve,3200));
    const result=await connection.status();
    if(result.status==='connected') { console.log('100x 已连接，凭据已在本机加密保存。'); process.exit(0); }
    if(['denied','expired'].includes(result.status)) throw new ConnectionError('100X_NOT_CONNECTED','本次连接未完成，请重新连接。');
  }
  throw new ConnectionError('100X_EXPIRED','连接已过期，请重试。');
} catch(error) { console.error(error instanceof ConnectionError?error.message:'100x 连接未完成，请稍后重试。'); process.exitCode=1; }
