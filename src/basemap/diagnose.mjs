// ==================== 高德静图 API 错误诊断 ====================
// 高德接口即使参数出错也返回 HTTP 200 + JSON 错误体，把 info/infocode 翻成可读中文提示。
// 返回 Error（不抛），err.code=amap_api_error 供调用方区分「接口明确报错」与「网络失败」。
export function diagnoseAmapApiError(info, infocode){
  let message;
  if(info === 'INVALID_USER_SCODE' || info === 'USERKEY_PLAT_NOMATCH'){
    message = 'key 类型不对：需要『Web服务』类型的 key，你申请的可能是『Web端(JS API)』类型。请在高德控制台新建一个『Web服务』key';
  } else if(info === 'DAILY_QUERY_OVER_LIMIT' || info === 'CUQPS_HAS_EXCEEDED_THE_LIMIT'){
    message = 'key 当日配额/并发已超限，稍后再试或更换 key';
  } else if(info === 'INVALID_USER_KEY'){
    message = 'key 无效：请检查是否复制完整';
  } else {
    message = `高德接口返回错误：${info}（${infocode}）`;
  }
  const err = new Error(message);
  err.code = 'amap_api_error';
  return err;
}
