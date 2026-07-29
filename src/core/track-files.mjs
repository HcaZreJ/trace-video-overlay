// ==================== 多轨迹文件首尾拼接 / 列表重排 ====================
// trackFiles: [{ name, format, points: [{lng,lat,ele?,time?}] }] 按列表顺序首尾拼接。
export function concatTrackPoints(trackFiles) {
  if (!trackFiles.length) return null;
  return trackFiles.flatMap(f => f.points);
}
// act ∈ {'up','down','del'}；返回重排/删除后的新数组，不改动入参。
export function reorderTrackFiles(files, act, i) {
  if (act === 'del') {
    if (i < 0 || i >= files.length) return [...files];
    return files.filter((_, idx) => idx !== i);
  }
  if (act === 'up' && i > 0 && i < files.length) {
    const result = [...files];
    [result[i - 1], result[i]] = [result[i], result[i - 1]];
    return result;
  }
  if (act === 'down' && i >= 0 && i < files.length - 1) {
    const result = [...files];
    [result[i], result[i + 1]] = [result[i + 1], result[i]];
    return result;
  }
  return [...files];
}
