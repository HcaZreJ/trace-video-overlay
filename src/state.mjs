// 跨层共享的可变状态。
//
// 用对象属性而不是四个具名 let：ES module 的导入绑定是只读的，
// 只有属性写入才能让渲染、导出、界面各层既读又写同一份状态。
// 只服务单一层的状态留在那一层自己的模块里，不进这里。
export const state = {
  trackFiles: [],                 // [{name,format,points}] 按列表顺序首尾拼接
  trackPoints: null,              // = concatTrackPoints(state.trackFiles) 的派生结果
  mapOverlayNeedsRefresh: false,  // 参数变化但还没预览时为 true
  previewProgress: 0.5,           // 动画预览扫拨条进度 0..1，初始居中
};

// 卡片渲染的基准边长；导出时按目标分辨率对它等比缩放。
export const CARD_SIZE = 600;
