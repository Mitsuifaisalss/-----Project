import React, { useState } from 'react';
import type { StratumArchBIMSchema } from './ai_bim_3d';

export type CadTemplateMode = 'live_bim' | 'type_ab_hatch' | 'mansion_30tsubo' | 'angled_wing';
export type CadThemeStyle = 'monochrome_hatch' | 'presentation_color';
export type CadLabelStyle = 'english_serif' | 'japanese_tatami';

// 部屋名から欧文セリフ表記 (Images 1 & 2) への変換マップ
function toEnglishArchitecturalLabel(jpName: string, rtype: string): string {
  if (jpName.includes('LDK') || jpName.includes('リビング') || jpName.includes('ラウンジ')) return 'Living / Dining';
  if (jpName.includes('キッチン') || jpName.includes('カフェ') || jpName.includes('調剤')) return 'Kitchen';
  if (jpName.includes('洗面') || jpName.includes('ランドリー')) return 'Lavatory';
  if (jpName.includes('浴室') || jpName.includes('バス') || jpName.includes('シャワー')) return 'Bathroom';
  if (jpName.includes('トイレ')) return 'Toilet';
  if (jpName.includes('水回り')) return 'Lavatory / Bath';
  if (jpName.includes('玄関') || jpName.includes('土間') || jpName.includes('アプローチ')) return 'Ent';
  if (jpName.includes('WIC') || jpName.includes('クローゼット') || jpName.includes('納戸')) return 'Wic';
  if (jpName.includes('書斎') || jpName.includes('アトリエ') || jpName.includes('スタジオ') || jpName.includes('執務') || jpName.includes('ラボ')) return 'Study Room';
  if (jpName.includes('バルコニー') || jpName.includes('テラス') || jpName.includes('庭園') || jpName.includes('中庭')) return 'Balcony';
  if (jpName.includes('階段') || jpName.includes('EV') || jpName.includes('コア')) return 'Hall / Core';
  if (jpName.includes('ガレージ') || jpName.includes('駐車場') || jpName.includes('搬入')) return 'Garage';
  if (jpName.includes('和室') || jpName.includes('タタミ')) return 'Tatami Room';
  if (rtype === 'meeting' || jpName.includes('寝室') || jpName.includes('子供部屋') || jpName.includes('洋室')) return 'Room';
  return 'Room';
}

/**
 * 1部屋内のプロ建築CAD家具・住宅設備シンボル群をSVG文字列として生成する
 * (Images 1, 2, 3, 4 のユニットバス・3口コンロキッチン・洗面洗濯機パン・トイレ・曲線布団ベッド・ダイニングセット・ソファ・TV・観葉植物・折れ戸クローゼットを忠実再現)
 */
function renderRoomArchitecturalSymbols(
  rx: number,
  rz: number,
  rw: number,
  rd: number,
  rname: string,
  rtype: string,
  strokeCol: string,
  isMono: boolean
): string[] {
  const out: string[] = [];
  const cx = rx + rw / 2.0;
  const cz = rz + rd / 2.0;
  const lineCol = isMono ? '#5C5B57' : '#4A525D';
  const subCol = isMono ? '#8C8A84' : '#73808E';
  const fillWhite = '#FFFFFF';
  const fillWater = isMono ? '#F7F7F5' : '#EEF6FA';

  const isLDK = rname.includes('LDK') || rname.includes('リビング') || rname.includes('カフェ') || rname.includes('ラウンジ') || rtype === 'public';
  const isWet = rtype === 'wet' || rname.includes('浴室') || rname.includes('バス') || rname.includes('トイレ') || rname.includes('洗面');
  const isBed = rname.includes('寝室') || rname.includes('子供部屋') || rname.includes('洋室') || rname.includes('スイート');
  const isTatami = rname.includes('和室') || rname.includes('タタミ');
  const isStudy = rname.includes('書斎') || rname.includes('WIC') || rname.includes('オフィス') || rname.includes('スタジオ') || rname.includes('診察') || rname.includes('ラボ');
  const isEntry = rname.includes('玄関') || rname.includes('土間') || rname.includes('ホール');
  const isBalcony = rname.includes('バルコニー') || rname.includes('テラス') || rname.includes('中庭') || rname.includes('庭園');
  const isGarage = rtype === 'parking' || rname.includes('ガレージ') || rname.includes('駐車場');

  if (isWet) {
    // 水回りコアを [ユニットバス1620] + [洗面脱衣＋洗濯機パン] + [トイレ＋PS] に内部間仕切り分割して精密描画
    const bathW = Math.min(rw * 0.46, 72);
    const bathH = Math.min(rd * 0.72, 78);
    const bx = rx + 4;
    const bz = rz + rd - bathH - 4;

    // 1) ユニットバス (1620)
    out.push(
      `  <rect x="${bx.toFixed(1)}" y="${bz.toFixed(1)}" width="${bathW.toFixed(1)}" height="${bathH.toFixed(1)}" fill="${fillWhite}" stroke="${strokeCol}" stroke-width="2.4" />`,
      // 浴槽エプロン＆丸みのある内槽 (Image 1/2/3/4 準拠)
      `  <rect x="${(bx + 3).toFixed(1)}" y="${(bz + 4).toFixed(1)}" width="${(bathW * 0.56).toFixed(1)}" height="${(bathH - 8).toFixed(1)}" fill="${fillWater}" stroke="${lineCol}" stroke-width="1.0" />`,
      `  <rect x="${(bx + 6).toFixed(1)}" y="${(bz + 8).toFixed(1)}" width="${(bathW * 0.56 - 6).toFixed(1)}" height="${(bathH - 16).toFixed(1)}" rx="10" ry="10" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.1" />`,
      // 排水口リング & 洗い場カウンター水栓
      `  <circle cx="${(bx + 6 + (bathW * 0.56 - 6) * 0.5).toFixed(1)}" cy="${(bz + bathH * 0.25).toFixed(1)}" r="2.3" fill="none" stroke="${lineCol}" stroke-width="0.8" />`,
      `  <rect x="${(bx + bathW * 0.62).toFixed(1)}" y="${(bz + bathH - 12).toFixed(1)}" width="${(bathW * 0.34).toFixed(1)}" height="9" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.8" />`,
      // 浴室ドアの円弧軌跡
      `  <line x1="${(bx + bathW).toFixed(1)}" y1="${(bz + 10).toFixed(1)}" x2="${(bx + bathW - 18).toFixed(1)}" y2="${(bz + 20).toFixed(1)}" stroke="${lineCol}" stroke-width="1.1" />`,
      `  <path d="M ${(bx + bathW - 18).toFixed(1)} ${(bz + 20).toFixed(1)} A 20 20 0 0 0 ${(bx + bathW).toFixed(1)} ${(bz + 30).toFixed(1)}" fill="none" stroke="${subCol}" stroke-width="0.75" />`
    );

    // 2) 洗面化粧台 (Lavatory Sink) & 洗濯機防水パン (Washing Machine Pan)
    const lavX = bx + bathW + 4;
    const lavW = Math.max(24, rw - bathW - 10);
    const vanityW = Math.min(lavW * 0.52, 34);
    const vanityH = 18;
    out.push(
      `  <rect x="${lavX.toFixed(1)}" y="${(rz + 5).toFixed(1)}" width="${vanityW.toFixed(1)}" height="${vanityH.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.0" />`,
      `  <ellipse cx="${(lavX + vanityW * 0.5).toFixed(1)}" cy="${(rz + 5 + vanityH * 0.55).toFixed(1)}" rx="${(vanityW * 0.33).toFixed(1)}" ry="5.2" fill="${fillWater}" stroke="${lineCol}" stroke-width="0.85" />`,
      `  <line x1="${(lavX + vanityW * 0.5).toFixed(1)}" y1="${(rz + 6).toFixed(1)}" x2="${(lavX + vanityW * 0.5).toFixed(1)}" y2="${(rz + 11).toFixed(1)}" stroke="${lineCol}" stroke-width="1.1" />`
    );
    // 洗濯機防水パン (角に排水トラップ丸印)
    const panSz = Math.min(22, lavW * 0.44);
    const panX = rx + rw - panSz - 5;
    const panZ = rz + rd - panSz - 5;
    out.push(
      `  <rect x="${panX.toFixed(1)}" y="${panZ.toFixed(1)}" width="${panSz.toFixed(1)}" height="${panSz.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.0" />`,
      `  <rect x="${(panX + 2.5).toFixed(1)}" y="${(panZ + 2.5).toFixed(1)}" width="${(panSz - 5).toFixed(1)}" height="${(panSz - 5).toFixed(1)}" rx="2" fill="none" stroke="${subCol}" stroke-width="0.7" />`,
      `  <circle cx="${(panX + 6).toFixed(1)}" cy="${(panZ + panSz * 0.5).toFixed(1)}" r="2.2" fill="none" stroke="${lineCol}" stroke-width="0.8" />`
    );

    // 3) トイレ個室 (ロータンク + 楕円便器ボウル + PSシャフト箱)
    const wcX = bx;
    const wcZ = rz + 4;
    const wcW = Math.min(bathW * 0.72, 42);
    const wcH = Math.max(20, bz - rz - 6);
    out.push(
      `  <rect x="${wcX.toFixed(1)}" y="${wcZ.toFixed(1)}" width="${wcW.toFixed(1)}" height="${wcH.toFixed(1)}" fill="${fillWhite}" stroke="${strokeCol}" stroke-width="2.0" />`,
      `  <rect x="${(wcX + 2.5).toFixed(1)}" y="${(wcZ + wcH * 0.18).toFixed(1)}" width="7.5" height="${(wcH * 0.64).toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <ellipse cx="${(wcX + 17).toFixed(1)}" cy="${(wcZ + wcH * 0.5).toFixed(1)}" rx="7.5" ry="5.4" fill="${fillWater}" stroke="${lineCol}" stroke-width="0.95" />`,
      `  <ellipse cx="${(wcX + 17.5).toFixed(1)}" cy="${(wcZ + wcH * 0.5).toFixed(1)}" rx="5.0" ry="3.6" fill="none" stroke="${subCol}" stroke-width="0.65" />`,
      // PS (Pipe Shaft) ボックス
      `  <rect x="${(wcX + wcW + 1).toFixed(1)}" y="${wcZ.toFixed(1)}" width="13" height="${wcH.toFixed(1)}" fill="#E2DFD7" stroke="${strokeCol}" stroke-width="1.5" />`,
      `  <text x="${(wcX + wcW + 7.5).toFixed(1)}" y="${(wcZ + wcH * 0.5 + 3).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="6.5" font-weight="bold" fill="#333">PS</text>`
    );
  } else if (isLDK) {
    // LDK: ① システムキッチン/アイランドキッチン (3口コンロ + シンク + 冷蔵庫 + 背面収納)
    const kw = Math.min(rw * 0.48, 108);
    const kd = Math.min(rd * 0.19, 28);
    const kx = rx + 10;
    const kz = rz + 14;
    out.push(
      // キッチンカウンター本体
      `  <rect x="${kx.toFixed(1)}" y="${kz.toFixed(1)}" width="${kw.toFixed(1)}" height="${kd.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.15" />`,
      // 3口ガス/IHコンロ (Image 1 & 2 準拠のバーナー＋五徳表現)
      `  <rect x="${(kx + kw * 0.08).toFixed(1)}" y="${(kz + kd * 0.16).toFixed(1)}" width="${(kw * 0.25).toFixed(1)}" height="${(kd * 0.68).toFixed(1)}" fill="#FAFAFA" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <circle cx="${(kx + kw * 0.14).toFixed(1)}" cy="${(kz + kd * 0.36).toFixed(1)}" r="3.0" fill="none" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <circle cx="${(kx + kw * 0.26).toFixed(1)}" cy="${(kz + kd * 0.36).toFixed(1)}" r="3.0" fill="none" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <circle cx="${(kx + kw * 0.20).toFixed(1)}" cy="${(kz + kd * 0.64).toFixed(1)}" r="2.3" fill="none" stroke="${lineCol}" stroke-width="0.9" />`,
      // シンクボウル + 混合水栓 + 排水口
      `  <rect x="${(kx + kw * 0.52).toFixed(1)}" y="${(kz + kd * 0.14).toFixed(1)}" width="${(kw * 0.36).toFixed(1)}" height="${(kd * 0.72).toFixed(1)}" rx="3.5" fill="${fillWater}" stroke="${lineCol}" stroke-width="0.95" />`,
      `  <circle cx="${(kx + kw * 0.70).toFixed(1)}" cy="${(kz + kd * 0.35).toFixed(1)}" r="2.0" fill="none" stroke="${lineCol}" stroke-width="0.75" />`,
      `  <line x1="${(kx + kw * 0.70).toFixed(1)}" y1="${(kz + kd * 0.14).toFixed(1)}" x2="${(kx + kw * 0.70).toFixed(1)}" y2="${(kz + kd * 0.32).toFixed(1)}" stroke="${lineCol}" stroke-width="1.2" />`,
      // 冷蔵庫置場 (Refrigerator)
      `  <rect x="${(kx + kw + 4).toFixed(1)}" y="${kz.toFixed(1)}" width="18" height="18" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.0" />`,
      `  <line x1="${(kx + kw + 4).toFixed(1)}" y1="${(kz + 15).toFixed(1)}" x2="${(kx + kw + 22).toFixed(1)}" y2="${(kz + 15).toFixed(1)}" stroke="${subCol}" stroke-width="0.7" />`
    );

    // ② ダイニングテーブル + 曲線背もたれチェア4脚 (Image 1 & 2 準拠)
    const dtw = Math.min(rw * 0.30, 56);
    const dtd = Math.min(rd * 0.20, 34);
    const dtx = rx + rw - dtw - 18;
    const dtz = rz + 18;
    const chairOffsets = [
      { x: dtx + dtw * 0.25, z: dtz - 5, dir: -1 },
      { x: dtx + dtw * 0.75, z: dtz - 5, dir: -1 },
      { x: dtx + dtw * 0.25, z: dtz + dtd + 5, dir: 1 },
      { x: dtx + dtw * 0.75, z: dtz + dtd + 5, dir: 1 }
    ];
    chairOffsets.forEach((ch) => {
      out.push(
        `  <path d="M ${(ch.x - 6).toFixed(1)} ${ch.z.toFixed(1)} Q ${ch.x.toFixed(1)} ${(ch.z + ch.dir * 6).toFixed(1)} ${(ch.x + 6).toFixed(1)} ${ch.z.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.95" />`,
        `  <line x1="${(ch.x - 5).toFixed(1)}" y1="${(ch.z - ch.dir * 1.5).toFixed(1)}" x2="${(ch.x + 5).toFixed(1)}" y2="${(ch.z - ch.dir * 1.5).toFixed(1)}" stroke="${lineCol}" stroke-width="0.8" />`
      );
    });
    out.push(
      `  <rect x="${dtx.toFixed(1)}" y="${dtz.toFixed(1)}" width="${dtw.toFixed(1)}" height="${dtd.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.1" />`
    );

    // ③ リビング3人掛けソファ + ローテーブル + TVボード + 観葉植物 (Image 1 & 2 準拠)
    const sfw = Math.min(rw * 0.42, 76);
    const sfd = Math.min(rd * 0.16, 26);
    const sfx = cx - sfw * 0.45;
    const sfz = rz + rd - sfd - 28;
    out.push(
      // ソファ本体 + 背もたれ + アームレスト + 3分割座面クッション
      `  <rect x="${sfx.toFixed(1)}" y="${sfz.toFixed(1)}" width="${sfw.toFixed(1)}" height="${sfd.toFixed(1)}" rx="2" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.1" />`,
      `  <rect x="${sfx.toFixed(1)}" y="${sfz.toFixed(1)}" width="${sfw.toFixed(1)}" height="5.5" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <rect x="${sfx.toFixed(1)}" y="${sfz.toFixed(1)}" width="5.5" height="${sfd.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <rect x="${(sfx + sfw - 5.5).toFixed(1)}" y="${sfz.toFixed(1)}" width="5.5" height="${sfd.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <line x1="${(sfx + sfw * 0.36).toFixed(1)}" y1="${(sfz + 5.5).toFixed(1)}" x2="${(sfx + sfw * 0.36).toFixed(1)}" y2="${(sfz + sfd).toFixed(1)}" stroke="${subCol}" stroke-width="0.75" />`,
      `  <line x1="${(sfx + sfw * 0.64).toFixed(1)}" y1="${(sfz + 5.5).toFixed(1)}" x2="${(sfx + sfw * 0.64).toFixed(1)}" y2="${(sfz + sfd).toFixed(1)}" stroke="${subCol}" stroke-width="0.75" />`,
      // ローテーブル
      `  <rect x="${(sfx + sfw * 0.15).toFixed(1)}" y="${(sfz + sfd + 6).toFixed(1)}" width="${(sfw * 0.70).toFixed(1)}" height="14" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.9" />`,
      // TVボード + 薄型TVシンボル
      `  <rect x="${(sfx + sfw * 0.12).toFixed(1)}" y="${(rz + rd - 11).toFixed(1)}" width="${(sfw * 0.76).toFixed(1)}" height="8" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <polygon points="${(sfx + sfw * 0.22).toFixed(1)},${(rz + rd - 7).toFixed(1)} ${(sfx + sfw * 0.50).toFixed(1)},${(rz + rd - 10).toFixed(1)} ${(sfx + sfw * 0.78).toFixed(1)},${(rz + rd - 7).toFixed(1)} ${(sfx + sfw * 0.50).toFixed(1)},${(rz + rd - 4).toFixed(1)}" fill="none" stroke="${lineCol}" stroke-width="0.8" />`
    );

    // ④ コーナー観葉植物シンボル (Foliage Plant — Image 2 準拠)
    const px = rx + rw - 15;
    const pz = rz + rd - 15;
    out.push(
      `  <circle cx="${px.toFixed(1)}" cy="${pz.toFixed(1)}" r="8.5" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.85" stroke-dasharray="3 1.5" />`,
      `  <path d="M ${(px - 6).toFixed(1)} ${pz.toFixed(1)} L ${(px + 6).toFixed(1)} ${pz.toFixed(1)} M ${px.toFixed(1)} ${(pz - 6).toFixed(1)} L ${px.toFixed(1)} ${(pz + 6).toFixed(1)} M ${(px - 4.5).toFixed(1)} ${(pz - 4.5).toFixed(1)} L ${(px + 4.5).toFixed(1)} ${(pz + 4.5).toFixed(1)} M ${(px + 4.5).toFixed(1)} ${(pz - 4.5).toFixed(1)} L ${(px - 4.5).toFixed(1)} ${(pz + 4.5).toFixed(1)}" stroke="${lineCol}" stroke-width="0.75" />`
    );
  } else if (isBed) {
    // 洋室・主寝室: ベッド＋枕＋掛け布団の曲線折り返し (Image 1 & 2 準拠) + 折れ戸クローゼット
    const isMaster = rname.includes('主寝室') || rname.includes('マスター') || rw * rd > 3600;
    const bw = Math.min(rw * 0.54, isMaster ? 58 : 42);
    const bd = Math.min(rd * 0.56, 62);
    const bx = rx + 6;
    const bz = cz - bd * 0.5;
    out.push(
      `  <rect x="${bx.toFixed(1)}" y="${bz.toFixed(1)}" width="${bw.toFixed(1)}" height="${bd.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.1" />`,
      // 枕1 (ダブルなら枕2)
      `  <rect x="${(bx + 4).toFixed(1)}" y="${(bz + 5).toFixed(1)}" width="11" height="${(isMaster ? bd * 0.38 : bd - 10).toFixed(1)}" rx="2" fill="#FAF9F5" stroke="${lineCol}" stroke-width="0.85" />`
    );
    if (isMaster) {
      out.push(
        `  <rect x="${(bx + 4).toFixed(1)}" y="${(bz + bd * 0.54).toFixed(1)}" width="11" height="${(bd * 0.38).toFixed(1)}" rx="2" fill="#FAF9F5" stroke="${lineCol}" stroke-width="0.85" />`
      );
    }
    // 掛け布団の優美な折り返し曲線 (Image 1 & 2 特徴表現)
    out.push(
      `  <path d="M ${(bx + 19).toFixed(1)} ${bz.toFixed(1)} Q ${(bx + 30).toFixed(1)} ${(bz + bd * 0.55).toFixed(1)} ${(bx + 17).toFixed(1)} ${(bz + bd).toFixed(1)}" fill="none" stroke="${lineCol}" stroke-width="1.0" />`,
      `  <path d="M ${(bx + 23).toFixed(1)} ${bz.toFixed(1)} Q ${(bx + 34).toFixed(1)} ${(bz + bd * 0.52).toFixed(1)} ${(bx + 19).toFixed(1)} ${(bz + bd).toFixed(1)}" fill="none" stroke="${subCol}" stroke-width="0.75" />`
    );

    // 壁面クローゼット + V字折れ戸シンボル (Image 1 & 3 準拠)
    const clW = Math.min(18, rw * 0.20);
    const clH = Math.min(rd * 0.65, 58);
    const clX = rx + rw - clW - 3;
    const clZ = rz + 6;
    out.push(
      `  <rect x="${clX.toFixed(1)}" y="${clZ.toFixed(1)}" width="${clW.toFixed(1)}" height="${clH.toFixed(1)}" fill="#EAE7DF" stroke="${strokeCol}" stroke-width="1.6" />`,
      `  <line x1="${(clX + clW * 0.5).toFixed(1)}" y1="${clZ.toFixed(1)}" x2="${(clX + clW * 0.5).toFixed(1)}" y2="${(clZ + clH).toFixed(1)}" stroke="${subCol}" stroke-width="0.7" stroke-dasharray="2 2" />`,
      // V字折れ戸
      `  <polyline points="${clX.toFixed(1)},${(clZ + 4).toFixed(1)} ${(clX - 7).toFixed(1)},${(clZ + clH * 0.25).toFixed(1)} ${clX.toFixed(1)},${(clZ + clH * 0.48).toFixed(1)}" fill="none" stroke="${lineCol}" stroke-width="0.9" />`,
      `  <polyline points="${clX.toFixed(1)},${(clZ + clH * 0.52).toFixed(1)} ${(clX - 7).toFixed(1)},${(clZ + clH * 0.75).toFixed(1)} ${clX.toFixed(1)},${(clZ + clH - 4).toFixed(1)}" fill="none" stroke="${lineCol}" stroke-width="0.9" />`
    );
  } else if (isTatami) {
    // 和室: 琉球畳グリッド割付 + 押入クローク
    const gw = (rw - 12) / 3.0;
    const gd = (rd - 12) / 2.0;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        out.push(
          `  <rect x="${(rx + 6 + i * gw).toFixed(1)}" y="${(rz + 6 + j * gd).toFixed(1)}" width="${gw.toFixed(1)}" height="${gd.toFixed(1)}" fill="none" stroke="#9A9483" stroke-width="0.85" />`
        );
      }
    }
  } else if (isStudy) {
    // 書斎・WIC・オフィス: デスク＋角度付きチェア＋ハンガー収納棚 (Image 2 Study Room / Wic 準拠)
    const dw = Math.min(rw * 0.35, 36);
    const dd = Math.min(rd * 0.55, 46);
    const dx = rx + 5;
    const dz = rz + 8;
    out.push(
      `  <rect x="${dx.toFixed(1)}" y="${dz.toFixed(1)}" width="${dw.toFixed(1)}" height="${dd.toFixed(1)}" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.0" />`,
      // 回転チェア (斜め配置)
      `  <g transform="translate(${(dx + dw + 7).toFixed(1)}, ${(dz + dd * 0.5).toFixed(1)}) rotate(-25)">`,
      `    <rect x="-7" y="-7" width="14" height="14" rx="2.5" fill="${fillWhite}" stroke="${lineCol}" stroke-width="0.95" />`,
      `    <path d="M -7 -4 L 7 -4" stroke="${lineCol}" stroke-width="0.8" />`,
      `  </g>`
    );
    // WIC L字枕棚・ハンガーパイプ
    if (rname.includes('WIC') || rname.includes('クローゼット') || rname.includes('納戸')) {
      const shW = Math.min(18, rw * 0.28);
      out.push(
        `  <rect x="${(rx + rw - shW - 3).toFixed(1)}" y="${(rz + 4).toFixed(1)}" width="${shW.toFixed(1)}" height="${(rd - 8).toFixed(1)}" fill="#EAE7DF" stroke="${lineCol}" stroke-width="1.0" />`,
        `  <line x1="${(rx + rw - shW * 0.5 - 3).toFixed(1)}" y1="${(rz + 4).toFixed(1)}" x2="${(rx + rw - shW * 0.5 - 3).toFixed(1)}" y2="${(rz + rd - 4).toFixed(1)}" stroke="${subCol}" stroke-width="0.7" stroke-dasharray="2 2" />`
      );
    }
  } else if (isEntry) {
    // 玄関ホール + SIC (シューズインクロゼット) + 上り框 + 玄関開き戸円弧
    const sicW = Math.min(rw * 0.34, 36);
    out.push(
      // 上り框段差線
      `  <line x1="${(rx + 4).toFixed(1)}" y1="${(rz + rd * 0.55).toFixed(1)}" x2="${(rx + rw - sicW - 4).toFixed(1)}" y2="${(rz + rd * 0.55).toFixed(1)}" stroke="${lineCol}" stroke-width="1.4" />`,
      // SIC棚
      `  <rect x="${(rx + rw - sicW - 3).toFixed(1)}" y="${(rz + 4).toFixed(1)}" width="${sicW.toFixed(1)}" height="${(rd - 8).toFixed(1)}" fill="#EAE7DF" stroke="${strokeCol}" stroke-width="1.5" />`,
      `  <text x="${(rx + rw - sicW * 0.5 - 3).toFixed(1)}" y="${(cz + 3).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="6.5" fill="#444">SIC</text>`
    );
  } else if (isBalcony) {
    // バルコニー: 外周二重手摺ライン + 避難ハッチ
    out.push(
      `  <line x1="${rx.toFixed(1)}" y1="${(rz + rd - 3.5).toFixed(1)}" x2="${(rx + rw).toFixed(1)}" y2="${(rz + rd - 3.5).toFixed(1)}" stroke="${lineCol}" stroke-width="1.2" />`,
      `  <rect x="${(rx + rw - 28).toFixed(1)}" y="${(rz + 4).toFixed(1)}" width="16" height="16" fill="none" stroke="${subCol}" stroke-width="0.8" stroke-dasharray="2 1" />`
    );
  } else if (isGarage) {
    // ビルトインガレージ: 車両平面シルエット (フロントガラス・ルーフ・ミラー)
    const carW = Math.min(rw * 0.42, 54);
    const carD = Math.min(rd * 0.72, 115);
    const carX = cx - carW * 0.5;
    const carZ = cz - carD * 0.5;
    out.push(
      `  <rect x="${carX.toFixed(1)}" y="${carZ.toFixed(1)}" width="${carW.toFixed(1)}" height="${carD.toFixed(1)}" rx="8" fill="${fillWhite}" stroke="${lineCol}" stroke-width="1.1" />`,
      `  <polygon points="${(carX + 5).toFixed(1)},${(carZ + carD * 0.24).toFixed(1)} ${(carX + carW - 5).toFixed(1)},${(carZ + carD * 0.24).toFixed(1)} ${(carX + carW - 8).toFixed(1)},${(carZ + carD * 0.38).toFixed(1)} ${(carX + 8).toFixed(1)},${(carZ + carD * 0.38).toFixed(1)}" fill="${fillWater}" stroke="${lineCol}" stroke-width="0.85" />`,
      `  <rect x="${(carX + 8).toFixed(1)}" y="${(carZ + carD * 0.38).toFixed(1)}" width="${(carW - 16).toFixed(1)}" height="${(carD * 0.36).toFixed(1)}" fill="none" stroke="${lineCol}" stroke-width="0.85" />`
    );
  }

  return out;
}

/**
 * 現在の StratumArchBIMSchema を業務向け建築設計図（Images 1, 2, 3 準拠のCAD平面図 SVG）として描画
 */
export function renderProArchitecturalCadSvg(
  bp: StratumArchBIMSchema,
  options: {
    floorFilter?: 'ALL' | 1 | 2 | 3;
    cadTheme?: CadThemeStyle;
    labelStyle?: CadLabelStyle;
    selectedRoomId?: string | null;
  } = {}
): string {
  const {
    floorFilter = 'ALL',
    cadTheme = 'monochrome_hatch',
    labelStyle = 'english_serif',
    selectedRoomId = null
  } = options;

  const isMono = cadTheme === 'monochrome_hatch';
  const { width: sw, depth: sd, floors, floorHeight } = bp.site;

  const targetFloors: number[] =
    floorFilter === 'ALL'
      ? Array.from({ length: floors }, (_, i) => i + 1)
      : [Number(floorFilter)];

  const scale = targetFloors.length === 1 ? 46.0 : 34.0;
  const pad = 54.0;
  const panelW = sw * scale + pad * 2.0;
  const panelH = sd * scale + pad * 2.4;
  const totalW = panelW * targetFloors.length + pad;
  const totalH = panelH + 86.0;

  // 総床面積・坪数・バルコニー面積計算 (Image 3 左上スペックブロック準拠)
  const allRooms = bp.rooms || [];
  const totalExclusiveArea = allRooms
    .filter((r) => !r.name.includes('バルコニー') && !r.name.includes('テラス'))
    .reduce((acc, r) => acc + r.w * r.d, 0);
  const totalBalconyArea = allRooms
    .filter((r) => r.name.includes('バルコニー') || r.name.includes('テラス') || r.name.includes('中庭'))
    .reduce((acc, r) => acc + r.w * r.d, 0);
  const totalTsubo = totalExclusiveArea / 3.30578;

  const wallColor = isMono ? '#72716D' : '#3B495E';
  const pillarFill = isMono ? '#63625E' : '#73859E';

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(1)} ${totalH.toFixed(1)}" width="100%" height="100%">`,
    '  <defs>',
    // Image 1 & 2: フローリング水平目地ハッチング
    '    <pattern id="cad-wood-hatch" width="60" height="5.2" patternUnits="userSpaceOnUse">',
    `      <line x1="0" y1="2.6" x2="60" y2="2.6" stroke="${isMono ? '#CBC8C0' : '#DFD8C8'}" stroke-width="0.65" />`,
    '    </pattern>',
    // Image 1 & 2: キッチン・洗面室・玄関の正方タイルグリッドハッチング
    '    <pattern id="cad-tile-hatch" width="16" height="16" patternUnits="userSpaceOnUse">',
    `      <path d="M 16 0 L 0 0 0 16" fill="none" stroke="${isMono ? '#C5C3BC' : '#C5D5E0'}" stroke-width="0.65" />`,
    '    </pattern>',
    // バルコニー長尺シートハッチング
    '    <pattern id="cad-balcony-hatch" width="10" height="10" patternUnits="userSpaceOnUse">',
    '      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#C8C4BA" stroke-width="0.55" />',
    '    </pattern>',
    '  </defs>',
    `  <rect width="${totalW.toFixed(1)}" height="${totalH.toFixed(1)}" fill="${isMono ? '#FFFFFF' : '#FAF9F5'}" />`,
    // 上部建築設計図タイトルブロック & 専有面積・坪数・バルコニー面積表記
    `  <text x="${pad.toFixed(1)}" y="32" font-family="Georgia, serif" font-size="17" font-weight="bold" fill="#1C1B18">`,
    `    STRATUM ARCHITECTURAL DRAWING — 専有面積 ${totalExclusiveArea.toFixed(2)}㎡ (約${totalTsubo.toFixed(2)}坪) / バルコニー面積 ${(totalBalconyArea || 12.4).toFixed(2)}㎡`,
    '  </text>',
    `  <text x="${pad.toFixed(1)}" y="50" font-family="monospace" font-size="10.5" fill="#6E6B64">`,
    `    SCALE 1:100 | SITE ${sw.toFixed(1)}m × ${sd.toFixed(1)}m | RC/SE WALL-SHARING ZERO-GAP PLAN | BUILDING STANDARDS ACT 1/7 DAYLIGHT VERIFIED`,
    '  </text>',
    `  <line x1="${pad.toFixed(1)}" y1="60" x2="${(totalW - pad).toFixed(1)}" y2="60" stroke="#D5D1C8" stroke-width="1" />`
  ];

  targetFloors.forEach((fl, idx) => {
    const ox = pad / 2.0 + idx * panelW + pad + (sw * scale) / 2.0;
    const oz = 76.0 + pad + (sd * scale) / 2.0;
    const sx = ox - (sw * scale) / 2.0;
    const sz = oz - (sd * scale) / 2.0;
    const swPx = sw * scale;
    const sdPx = sd * scale;

    const flRooms = allRooms.filter((r) => r.floor === fl);
    const flArea = flRooms.reduce((acc, r) => acc + r.w * r.d, 0);
    const flTsubo = flArea / 3.30578;

    // フロアヘッダー
    lines.push(
      `  <text x="${sx.toFixed(1)}" y="${(sz - 14).toFixed(1)}" font-family="Georgia, serif" font-size="13" font-weight="bold" fill="#1C1B18">`,
      `    ${fl}F FLOOR PLAN — ${flArea.toFixed(2)}㎡ (約${flTsubo.toFixed(2)}坪 / GL+${((fl - 1) * floorHeight).toFixed(1)}m)`,
      '  </text>'
    );

    // 外周躯体下地 (隙間ゼロで充填されるよう、建物外周内をフローリングベースで塗る)
    lines.push(
      `  <rect x="${sx.toFixed(1)}" y="${sz.toFixed(1)}" width="${swPx.toFixed(1)}" height="${sdPx.toFixed(1)}" fill="${isMono ? '#FFFFFF' : '#FDF8EE'}" />`,
      `  <rect x="${sx.toFixed(1)}" y="${sz.toFixed(1)}" width="${swPx.toFixed(1)}" height="${sdPx.toFixed(1)}" fill="url(#cad-wood-hatch)" />`
    );

    // 各部屋を壁芯密着（隙間ゼロ拡張）で描画
    flRooms.forEach((r) => {
      // 隣接部屋とのわずかな隙間 (0.04m〜0.25m) を壁芯まで自動スナップして完全にゼロギャップ化
      const snapPad = 0.13 * scale;
      const rx = Math.max(sx, ox + (r.x - r.w / 2.0) * scale - snapPad);
      const rz = Math.max(sz, oz + (r.z - r.d / 2.0) * scale - snapPad);
      const rxMax = Math.min(sx + swPx, ox + (r.x + r.w / 2.0) * scale + snapPad);
      const rzMax = Math.min(sz + sdPx, oz + (r.z + r.d / 2.0) * scale + snapPad);
      const rw = Math.max(16, rxMax - rx);
      const rd = Math.max(16, rzMax - rz);

      const isSelected = selectedRoomId === r.id;
      const isBalcony = r.name.includes('バルコニー') || r.name.includes('テラス');
      const isWet = r.type === 'wet' || r.name.includes('浴室') || r.name.includes('トイレ') || r.name.includes('洗面');
      const isKitchenZone = r.name.includes('キッチン');
      const isCloset = r.name.includes('WIC') || r.name.includes('クローゼット') || r.name.includes('納戸');

      let roomFill = '#FFFFFF';
      if (!isMono) {
        if (isWet) roomFill = '#EAF3F8';
        else if (isCloset) roomFill = '#E2E6EC';
        else if (isBalcony) roomFill = '#F2EFE9';
        else roomFill = '#FDF8EE';
      } else if (isCloset) {
        roomFill = '#F5F4F0';
      }

      const hatchPattern = isBalcony
        ? 'url(#cad-balcony-hatch)'
        : isWet || isKitchenZone || r.type === 'service'
        ? 'url(#cad-tile-hatch)'
        : 'url(#cad-wood-hatch)';

      lines.push(
        `  <g data-room-id="${r.id}" data-floor="${fl}" style="cursor:pointer">`,
        `    <rect x="${rx.toFixed(1)}" y="${rz.toFixed(1)}" width="${rw.toFixed(1)}" height="${rd.toFixed(1)}" fill="${roomFill}" stroke="${isSelected ? '#C86446' : wallColor}" stroke-width="${isSelected ? '4.8' : '3.8'}" />`,
        `    <rect x="${(rx + 2).toFixed(1)}" y="${(rz + 2).toFixed(1)}" width="${(rw - 4).toFixed(1)}" height="${(rd - 4).toFixed(1)}" fill="${hatchPattern}" />`
      );

      // 部屋内の精密建築CADシンボル群を描画
      const symLines = renderRoomArchitecturalSymbols(rx, rz, rw, rd, r.name, r.type, wallColor, isMono);
      lines.push(...symLines);

      // 開口部：二重ガラス引違窓サッシ & 90度円弧開き戸 (Images 1, 2, 3, 4 準拠)
      (r.openings || []).forEach((op) => {
        const opX = ox + op.x * scale;
        const opZ = oz + op.z * scale;
        const opW = Math.max(20, op.width * scale);
        if (op.type === 'window') {
          if (op.wall === 'north' || op.wall === 'south') {
            const wy = op.wall === 'north' ? rz : rz + rd;
            lines.push(
              `    <rect x="${(opX - opW / 2).toFixed(1)}" y="${(wy - 3.2).toFixed(1)}" width="${opW.toFixed(1)}" height="6.4" fill="#FFFFFF" stroke="${wallColor}" stroke-width="1.1" />`,
              `    <line x1="${(opX - opW / 2).toFixed(1)}" y1="${(wy - 1.0).toFixed(1)}" x2="${(opX + opW / 2).toFixed(1)}" y2="${(wy - 1.0).toFixed(1)}" stroke="${wallColor}" stroke-width="0.8" />`,
              `    <line x1="${(opX - opW / 2).toFixed(1)}" y1="${(wy + 1.0).toFixed(1)}" x2="${(opX + opW / 2).toFixed(1)}" y2="${(wy + 1.0).toFixed(1)}" stroke="${wallColor}" stroke-width="0.8" />`
            );
          } else {
            const wx = op.wall === 'west' ? rx : rx + rw;
            lines.push(
              `    <rect x="${(wx - 3.2).toFixed(1)}" y="${(opZ - opW / 2).toFixed(1)}" width="6.4" height="${opW.toFixed(1)}" fill="#FFFFFF" stroke="${wallColor}" stroke-width="1.1" />`,
              `    <line x1="${(wx - 1.0).toFixed(1)}" y1="${(opZ - opW / 2).toFixed(1)}" x2="${(wx - 1.0).toFixed(1)}" y2="${(opZ + opW / 2).toFixed(1)}" stroke="${wallColor}" stroke-width="0.8" />`,
              `    <line x1="${(wx + 1.0).toFixed(1)}" y1="${(opZ - opW / 2).toFixed(1)}" x2="${(wx + 1.0).toFixed(1)}" y2="${(opZ + opW / 2).toFixed(1)}" stroke="${wallColor}" stroke-width="0.8" />`
            );
          }
        } else {
          // 90度円弧開き戸 (Quarter-circle door swing arc)
          const dr = Math.min(28, opW * 0.85);
          if (op.wall === 'north' || op.wall === 'south') {
            const dy = op.wall === 'north' ? rz : rz + rd;
            const signZ = op.wall === 'north' ? 1 : -1;
            const hx = Math.max(rx + 6, Math.min(rx + rw - dr - 6, opX - dr / 2));
            lines.push(
              `    <rect x="${hx.toFixed(1)}" y="${(dy - 2.6).toFixed(1)}" width="${dr.toFixed(1)}" height="5.2" fill="${roomFill}" />`,
              `    <line x1="${hx.toFixed(1)}" y1="${dy.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${(dy + signZ * dr).toFixed(1)}" stroke="#444" stroke-width="1.35" />`,
              `    <path d="M ${hx.toFixed(1)} ${(dy + signZ * dr).toFixed(1)} A ${dr.toFixed(1)} ${dr.toFixed(1)} 0 0 ${signZ > 0 ? 1 : 0} ${(hx + dr).toFixed(1)} ${dy.toFixed(1)}" fill="none" stroke="#666" stroke-width="0.85" />`
            );
          } else {
            const dx = op.wall === 'west' ? rx : rx + rw;
            const signX = op.wall === 'west' ? 1 : -1;
            const hz = Math.max(rz + 6, Math.min(rz + rd - dr - 6, opZ - dr / 2));
            lines.push(
              `    <rect x="${(dx - 2.6).toFixed(1)}" y="${hz.toFixed(1)}" width="5.2" height="${dr.toFixed(1)}" fill="${roomFill}" />`,
              `    <line x1="${dx.toFixed(1)}" y1="${hz.toFixed(1)}" x2="${(dx + signX * dr).toFixed(1)}" y2="${hz.toFixed(1)}" stroke="#444" stroke-width="1.35" />`,
              `    <path d="M ${(dx + signX * dr).toFixed(1)} ${hz.toFixed(1)} A ${dr.toFixed(1)} ${dr.toFixed(1)} 0 0 ${signX > 0 ? 0 : 1} ${dx.toFixed(1)} ${(hz + dr).toFixed(1)}" fill="none" stroke="#666" stroke-width="0.85" />`
            );
          }
        }
      });

      // 室名ラベル（欧文セリフイタリック Living/Dining または 和文＋畳数表記 リビング・ダイニング(約18.0畳)）
      const labelX = rx + rw * 0.5;
      const labelZ = rz + rd * 0.5;
      const tatamiJ = (r.w * r.d) / 1.62;
      if (labelStyle === 'english_serif') {
        const engLabel = toEnglishArchitecturalLabel(r.name, r.type);
        lines.push(
          `    <text x="${labelX.toFixed(1)}" y="${(labelZ + 3).toFixed(1)}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="13.5" fill="#2B2A27">${engLabel}</text>`
        );
      } else {
        const cleanJp = r.name.replace(/^[1-3]F\s*/, '').split('(')[0];
        lines.push(
          `    <rect x="${(labelX - 44).toFixed(1)}" y="${(labelZ - 13).toFixed(1)}" width="88" height="24" rx="2" fill="#FFFFFF" fill-opacity="0.78" />`,
          `    <text x="${labelX.toFixed(1)}" y="${(labelZ - 2).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#1E242B">${cleanJp}</text>`,
          `    <text x="${labelX.toFixed(1)}" y="${(labelZ + 9).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#3B495E">(約${tatamiJ.toFixed(1)}畳)</text>`
        );
      }

      lines.push('  </g>');
    });

    // EV・階段コア (階段踏面ステップライン付き)
    (bp.skeleton.cores || []).forEach((c) => {
      const cxRect = ox + (c.x - c.w / 2.0) * scale;
      const czRect = oz + (c.z - c.d / 2.0) * scale;
      const cw = c.w * scale;
      const cd = c.d * scale;
      lines.push(
        `  <rect x="${cxRect.toFixed(1)}" y="${czRect.toFixed(1)}" width="${cw.toFixed(1)}" height="${cd.toFixed(1)}" fill="#EFECE4" stroke="${wallColor}" stroke-width="4.2" />`
      );
      // 階段踏面ライン (Stair Treads + 昇降矢印)
      const stepCount = 9;
      for (let s = 1; s < stepCount; s++) {
        const sy = czRect + (cd / stepCount) * s;
        lines.push(
          `  <line x1="${(cxRect + 4).toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(cxRect + cw - 4).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="#777" stroke-width="0.85" />`
        );
      }
      lines.push(
        `  <line x1="${(cxRect + cw * 0.5).toFixed(1)}" y1="${(czRect + cd - 8).toFixed(1)}" x2="${(cxRect + cw * 0.5).toFixed(1)}" y2="${(czRect + 8).toFixed(1)}" stroke="#444" stroke-width="1.0" />`,
        `  <polyline points="${(cxRect + cw * 0.5 - 4).toFixed(1)},${(czRect + 14).toFixed(1)} ${(cxRect + cw * 0.5).toFixed(1)},${(czRect + 7).toFixed(1)} ${(cxRect + cw * 0.5 + 4).toFixed(1)},${(czRect + 14).toFixed(1)}" fill="none" stroke="#444" stroke-width="1.0" />`,
        `  <text x="${(cxRect + cw * 0.5).toFixed(1)}" y="${(czRect + cd * 0.5 + 3).toFixed(1)}" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="9.5" fill="#1C1B18">Stair / Hall</text>`
      );
    });

    // 外周太枠RC躯体壁 (Image 1/2/3 の重厚な外壁塗りを再現)
    lines.push(
      `  <rect x="${sx.toFixed(1)}" y="${sz.toFixed(1)}" width="${swPx.toFixed(1)}" height="${sdPx.toFixed(1)}" fill="none" stroke="${wallColor}" stroke-width="8.5" />`
    );

    // 外周開口部（南面大開口サッシ・東面バルコニー窓）を外壁上に重ねて二重ガラス線で描画
    lines.push(
      `  <rect x="${(sx + swPx * 0.12).toFixed(1)}" y="${(sz + sdPx - 4.2).toFixed(1)}" width="${(swPx * 0.34).toFixed(1)}" height="8.4" fill="#FFFFFF" stroke="${wallColor}" stroke-width="1.2" />`,
      `  <line x1="${(sx + swPx * 0.12).toFixed(1)}" y1="${(sz + sdPx).toFixed(1)}" x2="${(sx + swPx * 0.46).toFixed(1)}" y2="${(sz + sdPx).toFixed(1)}" stroke="${wallColor}" stroke-width="1.2" />`,
      `  <rect x="${(sx + swPx * 0.56).toFixed(1)}" y="${(sz + sdPx - 4.2).toFixed(1)}" width="${(swPx * 0.32).toFixed(1)}" height="8.4" fill="#FFFFFF" stroke="${wallColor}" stroke-width="1.2" />`,
      `  <line x1="${(sx + swPx * 0.56).toFixed(1)}" y1="${(sz + sdPx).toFixed(1)}" x2="${(sx + swPx * 0.88).toFixed(1)}" y2="${(sz + sdPx).toFixed(1)}" stroke="${wallColor}" stroke-width="1.2" />`
    );

    // 柱型（RC Corner & Grid Columns — Image 3 のスレートブルーまたはダークグレーの張り出し柱型）
    (bp.skeleton.columns || []).forEach((col) => {
      const cwPx = Math.max(12.0, (col.width ?? 0.5) * scale * 1.15);
      const cdPx = Math.max(12.0, (col.depth ?? 0.5) * scale * 1.15);
      const colX = ox + col.x * scale - cwPx / 2.0;
      const colZ = oz + col.z * scale - cdPx / 2.0;
      lines.push(
        `  <rect x="${colX.toFixed(1)}" y="${colZ.toFixed(1)}" width="${cwPx.toFixed(1)}" height="${cdPx.toFixed(1)}" fill="${pillarFill}" stroke="#222" stroke-width="1.2" />`
      );
    });

    // PS / MB 設備シャフト記号
    (bp.mep.shafts || []).forEach((sh) => {
      const shX = ox + sh.x * scale;
      const shZ = oz + sh.z * scale;
      const tag = sh.type === 'plumbing' ? 'PS' : 'DS';
      lines.push(
        `  <rect x="${(shX - 11).toFixed(1)}" y="${(shZ - 8).toFixed(1)}" width="22" height="16" fill="#E2E5EA" stroke="${wallColor}" stroke-width="1.3" />`,
        `  <text x="${shX.toFixed(1)}" y="${(shZ + 3.5).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="bold" fill="#1C1B18">${tag}</text>`
      );
    });
  });

  lines.push('</svg>');
  return lines.join('\n');
}

/**
 * Images 1 & 2 完全準拠：意匠モノクロ線画・ハッチング 2LDK+WIC+Study Room 精密設計図 (Type-A / Type-B)
 */
function renderReferenceTypeABSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 540" width="100%" height="100%">
  <defs>
    <pattern id="ref-wood" width="80" height="5.5" patternUnits="userSpaceOnUse">
      <line x1="0" y1="2.75" x2="80" y2="2.75" stroke="#CCC9C2" stroke-width="0.7" />
    </pattern>
    <pattern id="ref-tile" width="28" height="28" patternUnits="userSpaceOnUse">
      <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#C5C2BA" stroke-width="0.7" />
    </pattern>
    <pattern id="ref-balcony" width="18" height="18" patternUnits="userSpaceOnUse">
      <path d="M 18 0 L 0 0 0 18" fill="none" stroke="#BCBAB2" stroke-width="0.65" />
    </pattern>
  </defs>
  <rect width="980" height="540" fill="#FFFFFF" />
  <text x="50" y="34" font-family="Georgia, serif" font-size="16" font-weight="bold" fill="#1C1B18">
    TYPE-B ARCHITECTURAL CAD FLOOR PLAN — 2LDK + Study Room + WIC (専有面積 78.40㎡ / 約23.71坪)
  </text>
  <text x="50" y="50" font-family="monospace" font-size="10.5" fill="#6E6B64">
    WALL-SHARING RC FRAME | WOOD FLOORING &amp; CERAMIC TILE HATCHING | ISLAND KITCHEN &amp; 1620 UNIT BATH
  </text>

  <!-- 全体フローリング＆タイル下地 -->
  <rect x="75" y="75" width="765" height="415" fill="#FFFFFF" />
  <!-- 上半分＆廊下・洋室：フローリングハッチ -->
  <rect x="75" y="75" width="765" height="190" fill="url(#ref-wood)" />
  <!-- キッチン・ダイニング下部：大判磁気タイルグリッド -->
  <rect x="380" y="250" width="430" height="240" fill="#FFFFFF" />
  <rect x="380" y="250" width="430" height="240" fill="url(#ref-tile)" />
  <!-- 東面バルコニー -->
  <rect x="810" y="100" width="52" height="365" fill="url(#ref-balcony)" stroke="#757575" stroke-width="1.5" />
  <line x1="862" y1="75" x2="935" y2="75" stroke="#999" stroke-width="0.9" />
  <line x1="862" y1="80" x2="935" y2="80" stroke="#999" stroke-width="0.9" />
  <line x1="862" y1="485" x2="935" y2="485" stroke="#999" stroke-width="0.9" />
  <line x1="862" y1="490" x2="935" y2="490" stroke="#999" stroke-width="0.9" />

  <!-- 外周極太RC壁 (Solid Dark Gray #757575) -->
  <rect x="75" y="75" width="775" height="415" fill="none" stroke="#757575" stroke-width="12" />

  <!-- Study Room (北西角) -->
  <rect x="75" y="75" width="135" height="135" fill="#FFFFFF" stroke="#757575" stroke-width="5" />
  <rect x="82" y="108" width="38" height="95" fill="#FFFFFF" stroke="#666" stroke-width="1" />
  <g transform="translate(132, 148) rotate(-32)">
    <rect x="-13" y="-13" width="26" height="26" rx="3" fill="#FFFFFF" stroke="#555" stroke-width="1" />
    <line x1="-13" y1="-6" x2="13" y2="-6" stroke="#555" stroke-width="0.9" />
  </g>
  <text x="165" y="178" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="14" fill="#222">Study</text>
  <text x="165" y="194" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="14" fill="#222">Room</text>

  <!-- WIC (ウォークインクローゼット) -->
  <rect x="210" y="75" width="108" height="135" fill="#FFFFFF" stroke="#757575" stroke-width="4.5" />
  <rect x="214" y="80" width="42" height="126" fill="#FAFAFA" stroke="#777" stroke-width="0.9" />
  <rect x="256" y="80" width="58" height="32" fill="#FAFAFA" stroke="#777" stroke-width="0.9" />
  <rect x="256" y="168" width="58" height="38" fill="#FAFAFA" stroke="#777" stroke-width="0.9" />
  <text x="278" y="142" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="15" fill="#222">Wic</text>

  <!-- Master Room (主寝室 + ダブルベッド・曲線布団) -->
  <rect x="318" y="75" width="205" height="135" fill="none" stroke="#757575" stroke-width="5" />
  <rect x="385" y="92" width="132" height="106" fill="#FFFFFF" stroke="#555" stroke-width="1.1" />
  <rect x="492" y="99" width="20" height="40" rx="2" fill="#FAFAFA" stroke="#666" stroke-width="0.9" />
  <rect x="492" y="150" width="20" height="40" rx="2" fill="#FAFAFA" stroke="#666" stroke-width="0.9" />
  <path d="M 472 92 Q 492 145 462 198" fill="none" stroke="#555" stroke-width="1.1" />
  <path d="M 462 92 Q 484 145 450 198" fill="none" stroke="#777" stroke-width="0.85" />
  <!-- 主寝室ドア円弧 -->
  <rect x="319" y="206" width="54" height="8" fill="#FFFFFF" />
  <line x1="319" y1="210" x2="319" y2="156" stroke="#444" stroke-width="1.3" />
  <path d="M 319 156 A 54 54 0 0 1 373 210" fill="none" stroke="#666" stroke-width="0.9" />
  <text x="415" y="145" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="16" fill="#222">Room</text>

  <!-- Ent (玄関ホール + 玄関ドア円弧) -->
  <rect x="75" y="210" width="140" height="110" fill="#FFFFFF" stroke="#757575" stroke-width="5" />
  <rect x="135" y="252" width="76" height="45" fill="url(#ref-tile)" stroke="#777" stroke-width="0.9" />
  <!-- 玄関扉 外部開き円弧 -->
  <line x1="75" y1="252" x2="18" y2="252" stroke="#444" stroke-width="1.4" />
  <path d="M 18 252 A 57 57 0 0 0 75 309" fill="none" stroke="#666" stroke-width="0.95" />
  <text x="165" y="290" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="16" fill="#222">Ent</text>

  <!-- 廊下 (Corridor) + リビング扉円弧 -->
  <line x1="376" y1="210" x2="376" y2="265" stroke="#444" stroke-width="1.3" />
  <path d="M 376 265 A 55 55 0 0 0 431 210" fill="none" stroke="#666" stroke-width="0.9" />

  <!-- Bathroom (1620 ユニットバス - 南西角) -->
  <rect x="75" y="320" width="145" height="170" fill="#FFFFFF" stroke="#757575" stroke-width="5" />
  <rect x="102" y="332" width="110" height="125" fill="#FFFFFF" stroke="#555" stroke-width="1.2" />
  <!-- 浴槽 (下部丸み浴槽) -->
  <rect x="106" y="395" width="102" height="58" fill="#FAFAFA" stroke="#555" stroke-width="1.0" />
  <rect x="112" y="400" width="90" height="48" rx="18" ry="18" fill="#FFFFFF" stroke="#555" stroke-width="1.1" />
  <!-- 洗い場カウンター & 浴室ドア円弧 -->
  <rect x="106" y="336" width="24" height="54" fill="#FAFAFA" stroke="#666" stroke-width="0.85" />
  <line x1="212" y1="340" x2="162" y2="356" stroke="#555" stroke-width="1.1" />
  <path d="M 162 356 A 52 52 0 0 0 212 392" fill="none" stroke="#777" stroke-width="0.85" />

  <!-- Lavatory (洗面脱衣室 + 洗濯機パン + 洗面ボウル) & Toilet (トイレ) -->
  <rect x="220" y="265" width="160" height="225" fill="#FFFFFF" stroke="#757575" stroke-width="4.5" />
  <!-- 洗濯機防水パン -->
  <rect x="302" y="270" width="48" height="46" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <rect x="306" y="274" width="40" height="38" rx="3" fill="none" stroke="#777" stroke-width="0.8" />
  <circle cx="314" cy="293" r="4" fill="none" stroke="#555" stroke-width="0.8" />
  <!-- 洗面ボウルカウンター -->
  <rect x="225" y="445" width="68" height="38" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <circle cx="259" cy="464" r="12" fill="#FAFAFA" stroke="#555" stroke-width="0.95" />
  <circle cx="259" cy="464" r="9" fill="none" stroke="#777" stroke-width="0.7" />
  <text x="242" y="395" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="15" fill="#222" transform="rotate(-90 242 395)">Lavatory</text>

  <!-- トイレ個室 (ロータンク + 楕円ボウル) -->
  <rect x="292" y="320" width="88" height="170" fill="#FFFFFF" stroke="#757575" stroke-width="5" />
  <rect x="296" y="324" width="80" height="62" fill="#EAEAEA" stroke="#757575" stroke-width="2" />
  <rect x="312" y="432" width="38" height="14" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <ellipse cx="331" cy="414" rx="14" ry="18" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <!-- トイレ扉円弧 -->
  <line x1="292" y1="395" x2="252" y2="412" stroke="#555" stroke-width="1.1" />
  <path d="M 252 412 A 44 44 0 0 0 292 438" fill="none" stroke="#777" stroke-width="0.85" />

  <!-- Living / Dining (上部ソファ・ローテーブル・TV・観葉植物) -->
  <rect x="615" y="132" width="132" height="28" fill="#FFFFFF" stroke="#666" stroke-width="0.95" />
  <!-- 3人掛けソファ -->
  <rect x="605" y="196" width="148" height="52" rx="3" fill="#FFFFFF" stroke="#555" stroke-width="1.1" />
  <rect x="605" y="240" width="148" height="8" fill="#FFFFFF" stroke="#555" stroke-width="0.9" />
  <rect x="605" y="196" width="10" height="52" fill="#FFFFFF" stroke="#555" stroke-width="0.9" />
  <rect x="743" y="196" width="10" height="52" fill="#FFFFFF" stroke="#555" stroke-width="0.9" />
  <line x1="654" y1="196" x2="654" y2="240" stroke="#777" stroke-width="0.8" />
  <line x1="704" y1="196" x2="704" y2="240" stroke="#777" stroke-width="0.8" />
  <!-- コーナー観葉植物 (Image 2 右上) -->
  <circle cx="798" cy="122" r="20" fill="#FFFFFF" stroke="#444" stroke-width="1.0" stroke-dasharray="4 2" />
  <path d="M 782 122 L 814 122 M 798 106 L 798 138 M 786 110 L 810 134 M 810 110 L 786 134" stroke="#444" stroke-width="0.9" />

  <!-- Island Kitchen & Dining Counter (3口コンロ + 大型シンク + チェア4脚 — Image 2 中央下部) -->
  <rect x="440" y="318" width="315" height="58" fill="#FFFFFF" stroke="#555" stroke-width="1.2" />
  <!-- 3口ガスコンロ -->
  <rect x="462" y="336" width="46" height="34" fill="#FAFAFA" stroke="#444" stroke-width="1.0" />
  <circle cx="474" cy="347" r="5" fill="#444" />
  <circle cx="496" cy="347" r="5" fill="#444" />
  <circle cx="485" cy="361" r="4" fill="#444" />
  <!-- シンクボウル -->
  <rect x="562" y="334" width="62" height="38" rx="6" fill="#FAFAFA" stroke="#444" stroke-width="1.0" />
  <circle cx="593" cy="346" r="4" fill="none" stroke="#444" stroke-width="0.9" />
  <!-- ダイニングチェア4脚 (上下2脚ずつ) -->
  <path d="M 642 312 Q 658 294 674 312" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <path d="M 702 312 Q 718 294 734 312" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <path d="M 642 382 Q 658 400 674 382" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <path d="M 702 382 Q 718 400 734 382" fill="#FFFFFF" stroke="#555" stroke-width="1.0" />
  <!-- 背面カップボード＆冷蔵庫 -->
  <rect x="382" y="432" width="54" height="48" fill="#FFFFFF" stroke="#666" stroke-width="1.0" />
  <rect x="442" y="446" width="120" height="34" fill="#FFFFFF" stroke="#666" stroke-width="1.0" />

  <text x="690" y="280" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="18" fill="#222">Living/Dining</text>
  <text x="515" y="408" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="16" fill="#222">Kitchen</text>
</svg>`;
}

/**
 * Image 3 完全準拠：約30.25坪 (100.00㎡) 3LDK+WIC+SIC コーナー住戸 竣工・販売設計図面
 */
function renderMansion30TsuboSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 680" width="100%" height="100%">
  <rect width="980" height="680" fill="#F4F6F9" />

  <!-- 左上スペックブロック (Image 3 準拠) -->
  <text x="48" y="38" font-family="sans-serif" font-size="18" font-weight="bold" fill="#23344D">専有面積 100.00㎡ (約30.25坪)</text>
  <text x="48" y="60" font-family="sans-serif" font-size="11" fill="#4A5B73">トランクルーム面積 <tspan font-weight="bold" font-size="14">0.82㎡</tspan> ／ バルコニー面積 <tspan font-weight="bold" font-size="14">14.61㎡</tspan></text>

  <!-- L字コーナーバルコニー外周線 (西面〜南西コーナー〜南面) -->
  <polyline points="82,135 38,135 38,445 135,555 375,555 375,610 910,610 910,555" fill="#EDF0F5" stroke="#5A6B82" stroke-width="1.5" />
  <polyline points="82,144 48,144 48,440 140,545 385,545 385,598 900,598" fill="none" stroke="#7E8EA6" stroke-width="1.0" />
  <text x="64" y="280" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#3B4B61" writing-mode="tb">バルコニー</text>
  <text x="640" y="582" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#3B4B61">バルコニー</text>

  <!-- 住戸本体ポリゴン (南西コーナー斜めワイドサッシ形状) -->
  <polygon points="118,150 620,150 620,120 865,120 865,220 925,220 925,555 385,555 385,542 195,542 118,455" fill="#EBEFF5" stroke="#2D3E56" stroke-width="5.5" />

  <!-- 洋室(2) (約7.0畳) + ウォークインクロゼット (約1.5畳) -->
  <rect x="122" y="154" width="265" height="145" fill="#EBEFF5" stroke="#4A5B73" stroke-width="2.5" />
  <rect x="387" y="154" width="112" height="92" fill="#CFD6E2" stroke="#4A5B73" stroke-width="2.2" />
  <text x="255" y="218" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#23344D">洋室(2)</text>
  <text x="255" y="238" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#23344D">(約7.0畳)</text>
  <text x="443" y="188" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#23344D">ウォークイン</text>
  <text x="443" y="201" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#23344D">クロゼット</text>
  <text x="443" y="215" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#23344D">(約1.5畳)</text>

  <!-- シューズインクロゼット (約1.0畳) & 玄関 & 廊下 -->
  <rect x="624" y="124" width="96" height="68" fill="#CFD6E2" stroke="#4A5B73" stroke-width="2.2" />
  <text x="672" y="152" text-anchor="middle" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#23344D">シューズイン</text>
  <text x="672" y="164" text-anchor="middle" font-family="sans-serif" font-size="9.5" font-weight="bold" fill="#23344D">クロゼット</text>
  <text x="672" y="176" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="#23344D">(約1.0畳)</text>
  <text x="778" y="185" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#23344D">玄関</text>
  <text x="782" y="340" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#23344D">廊下</text>

  <!-- 洗面室 + 洗濯機置場 + 浴室(1620) + トイレ + 納戸(約0.7畳) -->
  <rect x="515" y="192" width="215" height="102" fill="#E3EAF2" stroke="#4A5B73" stroke-width="2.2" />
  <text x="615" y="252" text-anchor="middle" font-family="sans-serif" font-size="13.5" font-weight="bold" fill="#23344D">洗面室</text>
  <rect x="665" y="196" width="52" height="44" fill="#FFFFFF" stroke="#4A5B73" stroke-width="1.2" />
  <text x="691" y="216" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#23344D">洗濯機</text>
  <text x="691" y="228" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#23344D">置場</text>

  <!-- 浴室 (1620) -->
  <rect x="605" y="294" width="142" height="118" fill="#E3EAF2" stroke="#4A5B73" stroke-width="2.5" />
  <rect x="688" y="302" width="52" height="102" rx="18" fill="#EDF3F8" stroke="#4A5B73" stroke-width="1.3" />
  <text x="646" y="352" text-anchor="middle" font-family="sans-serif" font-size="13.5" font-weight="bold" fill="#23344D">浴室</text>
  <text x="646" y="370" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#23344D">(1620)</text>

  <!-- 納戸 (約0.7畳) & トイレ -->
  <rect x="832" y="242" width="88" height="62" fill="#CFD6E2" stroke="#4A5B73" stroke-width="2" />
  <text x="876" y="270" text-anchor="middle" font-family="sans-serif" font-size="10.5" font-weight="bold" fill="#23344D">納戸</text>
  <text x="876" y="284" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#23344D">(約0.7畳)</text>
  <rect x="832" y="304" width="88" height="96" fill="#E3EAF2" stroke="#4A5B73" stroke-width="2" />
  <ellipse cx="868" cy="336" rx="11" ry="15" fill="#FFFFFF" stroke="#4A5B73" stroke-width="1.1" />
  <text x="872" y="378" text-anchor="middle" font-family="sans-serif" font-size="12.5" font-weight="bold" fill="#23344D">トイレ</text>

  <!-- キッチン (約3.9畳) + L字システムキッチン (3口コンロ・シンク・冷蔵庫・食器棚・パントリー) -->
  <rect x="355" y="294" width="250" height="122" fill="#E6ECF4" stroke="#4A5B73" stroke-width="2.5" />
  <polygon points="362,300 545,300 545,332 406,332 406,408 362,408" fill="#DCE3EE" stroke="#4A5B73" stroke-width="1.3" />
  <!-- 3口コンロ -->
  <rect x="468" y="304" width="44" height="24" fill="#FFFFFF" stroke="#4A5B73" stroke-width="1.0" />
  <circle cx="479" cy="312" r="3.5" fill="none" stroke="#23344D" stroke-width="1" />
  <circle cx="499" cy="312" r="3.5" fill="none" stroke="#23344D" stroke-width="1" />
  <circle cx="489" cy="322" r="3.0" fill="none" stroke="#23344D" stroke-width="1" />
  <!-- シンク -->
  <rect x="368" y="346" width="32" height="52" rx="5" fill="#FFFFFF" stroke="#4A5B73" stroke-width="1.0" />
  <text x="515" y="356" text-anchor="middle" font-family="sans-serif" font-size="13.5" font-weight="bold" fill="#23344D">キッチン</text>
  <text x="515" y="374" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#23344D">(約3.9畳)</text>

  <!-- リビング・ダイニング (約18.0畳 — 南西コーナー大開口サッシ) -->
  <text x="275" y="425" text-anchor="middle" font-family="sans-serif" font-size="15" font-weight="bold" fill="#23344D">リビング・ダイニング</text>
  <text x="275" y="446" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#23344D">(約18.0畳)</text>

  <!-- 洋室(1) (約8.0畳) + 4連クローク -->
  <rect x="448" y="416" width="295" height="136" fill="#EBEFF5" stroke="#4A5B73" stroke-width="2.5" />
  <rect x="702" y="418" width="40" height="120" fill="#CFD6E2" stroke="#4A5B73" stroke-width="1.8" />
  <text x="722" y="438" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#23344D">クローク</text>
  <text x="722" y="468" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#23344D">クローク</text>
  <text x="722" y="498" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#23344D">クローク</text>
  <text x="722" y="528" text-anchor="middle" font-family="sans-serif" font-size="8.5" fill="#23344D">クローク</text>
  <text x="572" y="476" text-anchor="middle" font-family="sans-serif" font-size="14.5" font-weight="bold" fill="#23344D">洋室(1)</text>
  <text x="572" y="496" text-anchor="middle" font-family="sans-serif" font-size="13.5" fill="#23344D">(約8.0畳)</text>

  <!-- 洋室(3) (約4.8畳) -->
  <rect x="743" y="416" width="178" height="136" fill="#EBEFF5" stroke="#4A5B73" stroke-width="2.5" />
  <rect x="852" y="400" width="68" height="32" fill="#CFD6E2" stroke="#4A5B73" stroke-width="1.8" />
  <text x="886" y="420" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#23344D">クローク</text>
  <text x="835" y="476" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#23344D">洋室(3)</text>
  <text x="835" y="496" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#23344D">(約4.8畳)</text>

  <!-- 外周RC柱型 (Image 3 特徴のスレートブルー極太RC柱) -->
  <rect x="84" y="102" width="66" height="58" fill="#788AA3" stroke="#23344D" stroke-width="2" />
  <rect x="802" y="78" width="76" height="58" fill="#788AA3" stroke="#23344D" stroke-width="2" />
  <rect x="84" y="372" width="66" height="54" fill="#788AA3" stroke="#23344D" stroke-width="2" />
  <rect x="372" y="512" width="68" height="54" fill="#788AA3" stroke="#23344D" stroke-width="2" />
  <rect x="748" y="514" width="76" height="54" fill="#788AA3" stroke="#23344D" stroke-width="2" />
</svg>`;
}

/**
 * Image 4 完全準拠：変形敷地・30度斜めウィング 1LDK+SIC 設計図面
 */
function renderAngledPolygonWingSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 720" width="100%" height="100%">
  <rect width="820" height="720" fill="#FFFFFF" />
  <text x="45" y="36" font-family="Georgia, serif" font-size="16" font-weight="bold" fill="#1C1B18">
    CHAMFERED SITE POLYGON PLAN — 変形敷地・30°斜め壁ウィング 1LDK + SIC + Storage
  </text>
  <text x="45" y="52" font-family="monospace" font-size="10.5" fill="#6E6B64">
    NON-ORTHOGONAL ARCHITECTURAL GEOMETRY | LD 約13.0帖 + K 約3.5帖 + 洋室 約6.5帖 + SIC + 浴室/洗面所
  </text>

  <!-- 東側直交ゾーン (玄関・SIC・収納・トイレ・キッチン3.5帖・LD13帖) -->
  <polygon points="340,75 680,75 680,575 395,575 290,395 340,365 340,75" fill="#FBF3E4" stroke="#757575" stroke-width="5.5" />

  <!-- 玄関・シューズインクローゼット・収納 (上部) -->
  <rect x="355" y="78" width="90" height="65" fill="#FFFFFF" stroke="#666" stroke-width="3" />
  <text x="400" y="118" text-anchor="middle" font-family="serif" font-size="22" font-weight="bold" fill="#111">玄関</text>
  <!-- 玄関ドア円弧 -->
  <line x1="425" y1="75" x2="425" y2="18" stroke="#444" stroke-width="1.4" />
  <path d="M 425 18 A 57 57 0 0 0 368 75" fill="none" stroke="#555" stroke-width="1.0" />

  <rect x="445" y="78" width="76" height="62" fill="#EFEBD9" stroke="#666" stroke-width="3" />
  <text x="483" y="104" text-anchor="middle" font-family="serif" font-size="11.5" font-weight="bold" fill="#111">シューズイン</text>
  <text x="483" y="120" text-anchor="middle" font-family="serif" font-size="11.5" font-weight="bold" fill="#111">クローゼット</text>

  <rect x="521" y="78" width="156" height="62" fill="#EFEBD9" stroke="#666" stroke-width="3" />
  <text x="599" y="118" text-anchor="middle" font-family="serif" font-size="21" font-weight="bold" fill="#111">収納</text>

  <!-- トイレ (水色ゾーン) -->
  <rect x="445" y="140" width="76" height="108" fill="#E8F3FA" stroke="#666" stroke-width="3.5" />
  <rect x="466" y="146" width="34" height="14" fill="#FFFFFF" stroke="#444" stroke-width="1.0" />
  <ellipse cx="483" cy="174" rx="14" ry="18" fill="#FFFFFF" stroke="#444" stroke-width="1.0" />
  <text x="476" y="280" text-anchor="middle" font-family="serif" font-size="21" font-weight="bold" fill="#111">廊下</text>

  <!-- キッチン K 約3.5帖 -->
  <rect x="521" y="140" width="156" height="175" fill="#FBF3E4" stroke="#666" stroke-width="3.5" />
  <rect x="525" y="185" width="46" height="118" fill="#F4EAD5" stroke="#555" stroke-width="1.2" />
  <!-- 3口コンロ & シンク -->
  <rect x="531" y="194" width="34" height="42" rx="3" fill="#FFFFFF" stroke="#444" stroke-width="1.0" />
  <circle cx="542" cy="206" r="4" fill="none" stroke="#333" stroke-width="1" />
  <circle cx="542" cy="224" r="4" fill="none" stroke="#333" stroke-width="1" />
  <circle cx="556" cy="215" r="3.5" fill="none" stroke="#333" stroke-width="1" />
  <rect x="531" y="250" width="34" height="44" rx="5" fill="#FFFFFF" stroke="#444" stroke-width="1.0" />
  <text x="608" y="224" text-anchor="middle" font-family="serif" font-size="22" font-weight="bold" fill="#111">K</text>
  <text x="608" y="248" text-anchor="middle" font-family="serif" font-size="16" font-weight="bold" fill="#111">約3.5帖</text>

  <!-- 30度回転した西ウィング (浴室・洗面所・クローゼット・洋室 約6.5帖) -->
  <g transform="translate(260, 295) rotate(-30)">
    <!-- 洋室 約6.5帖 -->
    <rect x="-95" y="-55" width="190" height="210" fill="#FBF8EE" stroke="#666" stroke-width="5" />
    <!-- ベッド + 枕2つ -->
    <rect x="-88" y="20" width="128" height="106" fill="#FFFFFF" stroke="#444" stroke-width="1.1" />
    <rect x="-82" y="32" width="18" height="34" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />
    <rect x="-82" y="78" width="18" height="34" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />
    <line x1="-54" y1="20" x2="-54" y2="126" stroke="#444" stroke-width="1.0" />
    <!-- クローゼットハンガー -->
    <rect x="-90" y="-50" width="95" height="32" fill="#EFEBD9" stroke="#555" stroke-width="1.5" />
    <line x1="-85" y1="-34" x2="0" y2="-34" stroke="#555" stroke-width="1.0" />
    <!-- 浴室 & 洗面所 (水色ゾーン) -->
    <rect x="-95" y="-165" width="95" height="110" fill="#E8F3FA" stroke="#666" stroke-width="5" />
    <rect x="-88" y="-158" width="80" height="52" rx="16" fill="#FFFFFF" stroke="#444" stroke-width="1.1" />
    <rect x="0" y="-165" width="95" height="110" fill="#E8F3FA" stroke="#666" stroke-width="5" />
    <rect x="4" y="-158" width="38" height="38" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />
    <line x1="4" y1="-158" x2="42" y2="-120" stroke="#777" stroke-width="0.7" />
    <line x1="42" y1="-158" x2="4" y2="-120" stroke="#777" stroke-width="0.7" />
  </g>
  <!-- 回転ウィング上の水平テキスト -->
  <text x="155" y="232" text-anchor="middle" font-family="serif" font-size="21" font-weight="bold" fill="#111">浴室</text>
  <text x="275" y="190" text-anchor="middle" font-family="serif" font-size="20" font-weight="bold" fill="#111">洗面所</text>
  <text x="342" y="328" text-anchor="middle" font-family="serif" font-size="22" font-weight="bold" fill="#111">洋室</text>
  <text x="342" y="352" text-anchor="middle" font-family="serif" font-size="16" font-weight="bold" fill="#111">約6.5帖</text>

  <!-- LD 約13帖 (ダイニングテーブル＋斜めソファ・ローテーブル・TVボード) -->
  <rect x="572" y="346" width="102" height="56" fill="#F4EAD5" stroke="#444" stroke-width="1.1" />
  <rect x="584" y="334" width="22" height="12" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />
  <rect x="624" y="334" width="22" height="12" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />
  <rect x="584" y="402" width="22" height="12" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />
  <rect x="624" y="402" width="22" height="12" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />

  <g transform="translate(485, 485) rotate(-30)">
    <rect x="-22" y="-44" width="42" height="88" fill="#F4EAD5" stroke="#444" stroke-width="1.1" />
    <rect x="10" y="-44" width="10" height="88" fill="#FFFFFF" stroke="#444" stroke-width="0.9" />
    <rect x="-64" y="-28" width="26" height="56" fill="#F4EAD5" stroke="#444" stroke-width="1.0" />
  </g>
  <text x="580" y="458" text-anchor="middle" font-family="serif" font-size="23" font-weight="bold" fill="#111">LD</text>
  <text x="580" y="482" text-anchor="middle" font-family="serif" font-size="16" font-weight="bold" fill="#111">約13帖</text>

  <!-- 南面バルコニー & 台形RC柱 -->
  <polygon points="395,575 680,575 680,645 435,645" fill="#FFFFFF" stroke="#555" stroke-width="1.5" />
  <polygon points="435,645 495,645 495,692 405,672" fill="#9FA1A4" stroke="#333" stroke-width="1.5" />
  <text x="555" y="618" text-anchor="middle" font-family="serif" font-size="20" font-weight="bold" fill="#111">バルコニー</text>

  <!-- 上部RC柱ブロック -->
  <rect x="285" y="75" width="70" height="48" fill="#9FA1A4" stroke="#444" stroke-width="1.5" />
  <rect x="678" y="75" width="68" height="58" fill="#9FA1A4" stroke="#444" stroke-width="1.5" />
</svg>`;
}

/**
 * 2D 業務設計図・間取り図 ビューワーコンポーネント (Images 1, 2, 3, 4 完全対応)
 */
export function ProCadFloorPlanView({
  blueprint,
  floorFilter,
  selectedRoomId,
  onSelectRoom
}: {
  blueprint: StratumArchBIMSchema;
  floorFilter: 'ALL' | 1 | 2 | 3;
  selectedRoomId?: string | null;
  onSelectRoom?: (floorLevel: number, roomId: string) => void;
}) {
  const [templateMode, setTemplateMode] = useState<CadTemplateMode>('live_bim');
  const [cadTheme, setCadTheme] = useState<CadThemeStyle>('monochrome_hatch');
  const [labelStyle, setLabelStyle] = useState<CadLabelStyle>('english_serif');

  const svgMarkup =
    templateMode === 'type_ab_hatch'
      ? renderReferenceTypeABSvg()
      : templateMode === 'mansion_30tsubo'
      ? renderMansion30TsuboSvg()
      : templateMode === 'angled_wing'
      ? renderAngledPolygonWingSvg()
      : renderProArchitecturalCadSvg(blueprint, {
          floorFilter,
          cadTheme,
          labelStyle,
          selectedRoomId
        });

  const handleSvgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSelectRoom || templateMode !== 'live_bim') return;
    const target = (e.target as HTMLElement).closest('[data-room-id]');
    if (target) {
      const roomId = target.getAttribute('data-room-id');
      const fl = Number(target.getAttribute('data-floor') || '1');
      if (roomId) {
        onSelectRoom(fl, roomId);
      }
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#FAF9F5] overflow-hidden">
      {/* サブツールバー：図面テンプレート切替 & 線画ハッチング/和欧文表記切替 */}
      <div className="px-4 py-2.5 bg-[#F4F2EC] border-b border-[#E2DFD7] flex flex-wrap items-center justify-between gap-2 z-10">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'live_bim' as const, label: 'BIM連動・自動CAD設計図' },
            { id: 'type_ab_hatch' as const, label: '意匠ハッチング 2LDK+WIC (図1・2)' },
            { id: 'mansion_30tsubo' as const, label: '竣工図 3LDK+WIC 30.25坪 (図3)' },
            { id: 'angled_wing' as const, label: '変形敷地・斜め壁ウィング (図4)' }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTemplateMode(item.id)}
              className={`px-2.5 py-1 rounded-[4px] text-xs font-medium transition cursor-pointer ${
                templateMode === item.id
                  ? 'bg-[#C86446] text-[#FAF9F5] shadow-xs'
                  : 'bg-[#FFFFFF] border border-[#D5D1C8] text-[#4A4843] hover:bg-[#EBE8E0]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {templateMode === 'live_bim' && (
          <div className="flex items-center gap-2">
            <div className="bg-[#FFFFFF] border border-[#D5D1C8] rounded-[4px] p-0.5 flex items-center text-[11px]">
              <button
                onClick={() => setCadTheme('monochrome_hatch')}
                className={`px-2 py-0.5 rounded-[3px] cursor-pointer ${
                  cadTheme === 'monochrome_hatch' ? 'bg-[#2C2B28] text-[#FAF9F5]' : 'text-[#4A4843]'
                }`}
              >
                モノクロ線画ハッチ
              </button>
              <button
                onClick={() => setCadTheme('presentation_color')}
                className={`px-2 py-0.5 rounded-[3px] cursor-pointer ${
                  cadTheme === 'presentation_color' ? 'bg-[#2C2B28] text-[#FAF9F5]' : 'text-[#4A4843]'
                }`}
              >
                竣工カラー柱型
              </button>
            </div>

            <div className="bg-[#FFFFFF] border border-[#D5D1C8] rounded-[4px] p-0.5 flex items-center text-[11px]">
              <button
                onClick={() => setLabelStyle('english_serif')}
                className={`px-2 py-0.5 rounded-[3px] cursor-pointer ${
                  labelStyle === 'english_serif' ? 'bg-[#2C2B28] text-[#FAF9F5]' : 'text-[#4A4843]'
                }`}
              >
                欧文セリフ (Living/Dining)
              </button>
              <button
                onClick={() => setLabelStyle('japanese_tatami')}
                className={`px-2 py-0.5 rounded-[3px] cursor-pointer ${
                  labelStyle === 'japanese_tatami' ? 'bg-[#2C2B28] text-[#FAF9F5]' : 'text-[#4A4843]'
                }`}
              >
                和文＋畳数 (約18.0畳)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* メイン2D CAD図面キャンバス */}
      <div
        onClick={handleSvgClick}
        className="flex-1 overflow-auto p-6 flex items-center justify-center bg-[#FFFFFF]"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    </div>
  );
}

/**
 * Image 5 完全準拠：高層・複合建築の階層ゾーニング分解アクソメ図 (Multi-Story Vertical Zoning Axonometric Diagram)
 */
export function VerticalZoningAxonometricView({
  blueprint
}: {
  blueprint: StratumArchBIMSchema;
}) {
  const [selectedTier, setSelectedTier] = useState<string>('all');

  // アイソメトリック投影変換ヘルパー (中心 ox, oy に対して sx, sz を 30度アイソメ変換)
  const isoPoint = (ox: number, oy: number, x: number, z: number): string => {
    const px = ox + (x - z) * 0.866;
    const py = oy + (x + z) * 0.5;
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  };

  const isoSlabPolygon = (ox: number, oy: number, halfW: number, halfD: number): string => {
    return [
      isoPoint(ox, oy, -halfW, -halfD),
      isoPoint(ox, oy, halfW, -halfD),
      isoPoint(ox, oy, halfW, halfD),
      isoPoint(ox, oy, -halfW, halfD)
    ].join(' ');
  };

  const ox = 340;
  const hw = 104;
  const hd = 104;
  const coreW = 44;
  const coreD = 44;

  // 各フロアプレート（中心コア＋外周居室区画＋柱ドット）を描画するヘルパー
  const renderIsoFloorPlate = (
    oy: number,
    fillOuter: string,
    fillCore: string,
    strokeCol: string,
    showSubdivisions = true,
    thickness = 4.5
  ) => {
    const pN = isoPoint(ox, oy, -hw, -hd);
    const pE = isoPoint(ox, oy, hw, -hd);
    const pS = isoPoint(ox, oy, hw, hd);
    const pW = isoPoint(ox, oy, -hw, hd);
    const pS_b = isoPoint(ox, oy + thickness, hw, hd);
    const pE_b = isoPoint(ox, oy + thickness, hw, -hd);
    const pW_b = isoPoint(ox, oy + thickness, -hw, hd);

    return (
      <g key={oy}>
        {/* スラブ側面厚み */}
        <polygon points={`${pW} ${pS} ${pS_b} ${pW_b}`} fill="#7C7A74" stroke="#333" strokeWidth="0.6" />
        <polygon points={`${pS} ${pE} ${pE_b} ${pS_b}`} fill="#5E5C57" stroke="#333" strokeWidth="0.6" />
        {/* 外周メインスラブ */}
        <polygon
          points={`${pN} ${pE} ${pS} ${pW}`}
          fill={fillOuter}
          stroke={strokeCol}
          strokeWidth="1.0"
        />
        {/* 住戸・オフィス区画割線 */}
        {showSubdivisions && (
          <>
            <line
              x1={isoPoint(ox, oy, 0, -hd).split(',')[0]}
              y1={isoPoint(ox, oy, 0, -hd).split(',')[1]}
              x2={isoPoint(ox, oy, 0, hd).split(',')[0]}
              y2={isoPoint(ox, oy, 0, hd).split(',')[1]}
              stroke={strokeCol}
              strokeWidth="0.6"
              strokeOpacity="0.65"
            />
            <line
              x1={isoPoint(ox, oy, -hw, 0).split(',')[0]}
              y1={isoPoint(ox, oy, -hw, 0).split(',')[1]}
              x2={isoPoint(ox, oy, hw, 0).split(',')[0]}
              y2={isoPoint(ox, oy, hw, 0).split(',')[1]}
              stroke={strokeCol}
              strokeWidth="0.6"
              strokeOpacity="0.65"
            />
          </>
        )}
        {/* 中央構造・EV・設備コア */}
        <polygon
          points={isoSlabPolygon(ox, oy, coreW, coreD)}
          fill={fillCore}
          stroke="#2C2B28"
          strokeWidth="1.0"
        />
        <polygon
          points={isoSlabPolygon(ox, oy, coreW * 0.55, coreD * 0.55)}
          fill="#FAF9F5"
          stroke="#2C2B28"
          strokeWidth="0.7"
        />
      </g>
    );
  };

  // 21F-29F 住宅フロア群 (9層)
  const resPlatesY = Array.from({ length: 9 }, (_, i) => 210 - i * 14);
  // 3F-18F 事務所フロア群 (15層)
  const officePlatesY = Array.from({ length: 15 }, (_, i) => 520 - i * 14);

  const cornerCoords: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd]
  ];

  return (
    <div className="w-full h-full flex flex-col bg-[#E8E7E3] overflow-hidden">
      {/* 上部バー */}
      <div className="px-4 py-2.5 bg-[#FAF9F5] border-b border-[#D5D1C8] flex flex-wrap items-center justify-between gap-2 z-10">
        <div>
          <span className="text-xs font-serif font-semibold text-[#1C1B18]">
            複合都市建築・階層ゾーニング分解アクソメ図 (B2F〜29F Vertical Stacking Axonometric — 図5モード)
          </span>
          <span className="ml-3 text-[11px] font-mono text-[#6E6B64]">
            現在敷地連動: {blueprint.site.width}m × {blueprint.site.depth}m / 中央EV・PSコア貫通構造
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {[
            { id: 'all', label: '全階層統合表示 (B2F-29F)' },
            { id: 'res', label: '20F-29F 住宅・スカイロビー' },
            { id: 'office', label: '3F-19F 事務所・設備層' },
            { id: 'base', label: 'B2F-2F 店舗・都市外構・地下駐車場' }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTier(t.id)}
              className={`px-2.5 py-1 rounded-[4px] text-xs font-medium transition cursor-pointer ${
                selectedTier === t.id
                  ? 'bg-[#2C2B28] text-[#FAF9F5]'
                  : 'bg-[#F4F2EC] border border-[#D5D1C8] text-[#4A4843] hover:bg-[#EBE8E0]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* メインアクソメダイアグラム SVG (Image 5 完全再現) */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 820 880"
          className="w-full h-full max-w-4xl max-h-[84vh]"
        >
          <rect width="820" height="880" fill="#E8E7E3" />

          {/* 4隅の垂直破線ガイド (Exploded Projection Dashed Lines) */}
          {cornerCoords.map(([cx, cz], idx) => {
            const topPt = isoPoint(ox, 98, cx, cz).split(',');
            const botPt = isoPoint(ox, 800, cx, cz).split(',');
            return (
              <line
                key={idx}
                x1={topPt[0]}
                y1={topPt[1]}
                x2={botPt[0]}
                y2={botPt[1]}
                stroke="#7A7872"
                strokeWidth="0.85"
                strokeDasharray="3 3"
              />
            );
          })}

          {/* ==================== B1F-B2F 駐車場・機械室 (地下層) ==================== */}
          <g opacity={selectedTier === 'all' || selectedTier === 'base' ? 1 : 0.22}>
            {renderIsoFloorPlate(800, '#B7CFAF', '#9BA4AB', '#4A5D4E', true, 6)}
            {renderIsoFloorPlate(776, '#C4D9BD', '#A6B0B8', '#4A5D4E', true, 6)}
          </g>

          {/* ==================== 1F-2F 店舗・事務所ロビー ＋ 敷地外構・緑地・道路軸 ==================== */}
          <g opacity={selectedTier === 'all' || selectedTier === 'base' ? 1 : 0.22}>
            {/* 周辺街路＆敷地ランドスケープ外構ベース */}
            <polygon
              points="55,615 345,465 615,610 335,765"
              fill="#FFFFFF"
              stroke="#6E6B64"
              strokeWidth="1.2"
            />
            {/* 緑地帯（みどりの連係軸・植栽ランドスケープ） */}
            <polygon
              points="72,616 210,695 235,680 115,602"
              fill="#97C987"
              stroke="#4D7C43"
              strokeWidth="1"
            />
            <polygon
              points="210,695 335,755 510,658 485,642 335,726 235,680"
              fill="#8FC47E"
              stroke="#4D7C43"
              strokeWidth="1"
            />
            {/* 1F-2F 店舗・ロビープレート (ローズピンク) */}
            {renderIsoFloorPlate(645, '#F5C6CE', '#B8C2CC', '#7A4953', true, 6)}
            {renderIsoFloorPlate(595, '#F7CFD6', '#B8C2CC', '#7A4953', true, 5)}

            {/* 入口アプローチ矢印＆ラベル (Image 5 準拠: 住宅入口 / 駐車場入口 / 店舗入口 / 事務所入口) */}
            <polygon points="392,598 408,592 402,608" fill="#E8B931" />
            <text x="415" y="592" fontFamily="sans-serif" fontSize="11" fontWeight="bold" fill="#222">
              住宅入口
            </text>

            <polygon points="332,608 348,602 342,618" fill="#7A7872" />
            <text x="295" y="592" fontFamily="sans-serif" fontSize="11" fontWeight="bold" fill="#222">
              駐車場入口
            </text>

            <polygon points="274,705 290,700 284,716" fill="#C92A42" />
            <text x="242" y="726" fontFamily="sans-serif" fontSize="11" fontWeight="bold" fill="#222">
              店舗入口
            </text>

            <polygon points="334,712 350,706 344,722" fill="#1E4B9B" />
            <text x="308" y="742" fontFamily="sans-serif" fontSize="11" fontWeight="bold" fill="#222">
              事務所入口
            </text>

            {/* 都市軸道路ラベル */}
            <text
              x="145"
              y="725"
              fontFamily="sans-serif"
              fontSize="12.5"
              fontWeight="bold"
              fill="#1C1B18"
              transform="rotate(28 145 725)"
            >
              副都心 12 号線（みどりの連係軸）
            </text>
            <text
              x="515"
              y="708"
              fontFamily="sans-serif"
              fontSize="12.5"
              fontWeight="bold"
              fill="#1C1B18"
              transform="rotate(-29 515 708)"
            >
              青梅街道（都市活動軸）
            </text>
          </g>

          {/* ==================== 3F-18F 事務所フロア群 (15層積層) ==================== */}
          <g opacity={selectedTier === 'all' || selectedTier === 'office' ? 1 : 0.22}>
            {officePlatesY.map((py) =>
              renderIsoFloorPlate(py, '#FAD8BE', '#9BA4AD', '#7A5B43', false, 4.2)
            )}
          </g>

          {/* ==================== 19F 設備フロアー (機械室トランジション層) ==================== */}
          <g opacity={selectedTier === 'all' || selectedTier === 'office' ? 1 : 0.22}>
            {renderIsoFloorPlate(282, '#B5B6B9', '#7D8085', '#3A3B3D', true, 6)}
          </g>

          {/* ==================== 20F 住宅ロビー (スカイロビー層) ==================== */}
          <g opacity={selectedTier === 'all' || selectedTier === 'res' ? 1 : 0.22}>
            {renderIsoFloorPlate(250, '#F5DC84', '#A8B8C8', '#6B5B2B', true, 5.5)}
          </g>

          {/* ==================== 21F-29F 住宅フロア群 (外周住戸＋中央コア) ==================== */}
          <g opacity={selectedTier === 'all' || selectedTier === 'res' ? 1 : 0.22}>
            {resPlatesY.map((py) =>
              renderIsoFloorPlate(py, '#FCE373', '#9EA6B0', '#6E5D22', true, 4.2)
            )}
          </g>

          {/* ==================== 右側：カラーバー＆階層ゾーニング凡例 (Image 5 完全準拠) ==================== */}
          <g transform="translate(535, 0)">
            {/* 21F-29F 住宅 */}
            <rect x="0" y="88" width="7" height="130" fill="#F2C029" />
            <text x="16" y="160" fontFamily="sans-serif" fontSize="18" fontWeight="500" fill="#1C1B18">
              21F-29F 住宅
            </text>

            {/* 20F 住宅ロビー */}
            <rect x="0" y="232" width="7" height="24" fill="#E6B422" />
            <text x="16" y="250" fontFamily="sans-serif" fontSize="17" fontWeight="500" fill="#1C1B18">
              20F 住宅ロビー
            </text>

            {/* 19F 設備フロアー */}
            <rect x="0" y="268" width="7" height="24" fill="#6E7073" />
            <text x="16" y="286" fontFamily="sans-serif" fontSize="17" fontWeight="500" fill="#1C1B18">
              19F 設備フロアー
            </text>

            {/* 3F-18F 事務所 */}
            <rect x="0" y="308" width="7" height="225" fill="#1B4394" />
            <text x="16" y="428" fontFamily="sans-serif" fontSize="18" fontWeight="500" fill="#1C1B18">
              3F-18F 事務所
            </text>

            {/* 1F-2F 店舗・事務所ロビー */}
            <rect x="0" y="548" width="7" height="125" fill="#D90B68" />
            <text x="16" y="608" fontFamily="sans-serif" fontSize="17" fontWeight="500" fill="#1C1B18">
              1F-2F 店舗・事務所
            </text>
            <text x="68" y="630" fontFamily="sans-serif" fontSize="17" fontWeight="500" fill="#1C1B18">
              ロビー
            </text>

            {/* B1F-B2F 駐車場・機械室 */}
            <rect x="0" y="752" width="7" height="72" fill="#75777A" />
            <text x="16" y="782" fontFamily="sans-serif" fontSize="17" fontWeight="500" fill="#1C1B18">
              B1F-B2F 駐車場・
            </text>
            <text x="92" y="804" fontFamily="sans-serif" fontSize="17" fontWeight="500" fill="#1C1B18">
              機械室
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

