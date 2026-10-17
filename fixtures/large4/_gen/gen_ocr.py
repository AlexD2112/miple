"""On-device OCR output simulation: Apple Vision VNRecognizedTextObservation-shaped JSON for existing synthetic receipts
(fixtures/large/receipts/clean + expected_clean.jsonl), with ground-truth line grouping and parsed items.
NOTE: the app itself does NOT run on-device OCR (mobile uploads the photo; server runs Perceptron OCR -> Gemini, Gemini vision as
fallback). Each record therefore also carries `app_text` (plain transcription in reading order, the contract of perceptronOcr()).
Geometry/confidence values are synthetic. python3 -B gen_ocr.py"""
import glob, math, uuid
from core4 import *

OUT = os.path.join(LARGE4, "ocr_vision")
CONF = {"O": "0", "0": "O", "I": "1", "1": "l", "l": "1", "S": "5", "5": "S", "B": "8", "8": "B", "Z": "2", "G": "6", "E": "F", ".": ",", ",": ".", "C": "(", "D": "0", "A": "4"}
ORDER_MODES = [("row_major", 0.55), ("row_jitter", 0.25), ("column_major", 0.12), ("shuffled_blocks", 0.08)]

def corrupt(s, rng, rate):
    out, i = [], 0
    while i < len(s):
        ch = s[i]
        if s[i:i + 2] == "rn" and rng.random() < rate: out.append("m"); i += 2; continue
        if ch in CONF and rng.random() < rate: out.append(CONF[ch])
        elif ch == " " and rng.random() < rate / 2: pass
        else: out.append(ch)
        i += 1
    return "".join(out)

def segments(line, rng, split_p):
    """Split a printed line at runs of >= 3 spaces (columns), like Vision often does; returns [(start, end)] over non-space spans."""
    spans = [(m.start(), m.end()) for m in re.finditer(r"\S+(?: {1,2}\S+)*", line)]
    if not spans: return []
    if rng.random() >= split_p: return [(spans[0][0], spans[-1][1])]
    return spans

def rot(px, py, cx, cy, th):
    dx, dy = px - cx, py - cy
    return cx + dx * math.cos(th) - dy * math.sin(th), cy + dx * math.sin(th) + dy * math.cos(th)

def build(rec, text, rng, k, variant):
    lines = text.split("\n")
    while lines and not lines[-1].strip(): lines.pop()
    ncols = max(len(l) for l in lines) + 4; nlines = len(lines) + 2
    W, H = rng.choice([(1170, 2532), (1179, 2556), (1284, 2778), (1080, 2400)]); W = int(W); H = int(H)
    # receipt occupies a sub-rectangle of the photo
    mx, my = rng.uniform(0.04, 0.14), rng.uniform(0.03, 0.10); RW, RH = (1 - 2 * mx) * W, (1 - 2 * my) * H
    cw, lh = RW / ncols, RH / nlines
    skew = rng.uniform(-3.5, 3.5) if rng.random() < 0.7 else 0.0; th = math.radians(skew)
    split_p = rng.uniform(0.3, 0.9); err = rng.choice([0.0, 0.005, 0.01, 0.02, 0.04]); merge_p = rng.choice([0, 0, 0.03, 0.06])
    cx, cy = W / 2, H / 2
    obs, gt_lines, truth = [], [], {}
    pending_merge = None
    def new_obs(text_truth, x0, x1, y0, y1, lines_idx):
        oid = str(uuid.UUID(int=rng.getrandbits(128), version=4)).upper()
        # pixel rect (y down) -> rotated corners -> normalized, origin bottom-left (Vision convention)
        pts = {"topLeft": (x0, y0), "topRight": (x1, y0), "bottomRight": (x1, y1), "bottomLeft": (x0, y1)}
        nc = {}
        for kname, (px, py) in pts.items():
            rx, ry = rot(px, py, cx, cy, th); nc[kname] = dict(x=round(min(max(rx / W, 0), 1), 4), y=round(min(max(1 - ry / H, 0), 1), 4))
        xs = [p["x"] for p in nc.values()]; ys = [p["y"] for p in nc.values()]
        bb = dict(x=min(xs), y=min(ys), width=round(max(xs) - min(xs), 4), height=round(max(ys) - min(ys), 4))
        wrong = rng.random() < err * max(len(text_truth), 1) * 0.6
        top = corrupt(text_truth, rng, max(err, 0.02) * 4) if wrong else text_truth
        if wrong and top == text_truth: wrong = False
        c1 = round(rng.uniform(0.3, 0.75) if wrong else rng.choice([1.0, 1.0, 0.5, rng.uniform(0.75, 1.0)]), 3)
        cands = [dict(string=top, confidence=c1)]
        alts = set()
        if wrong and rng.random() < 0.7: alts.add(text_truth)
        for _ in range(rng.randint(0, 2)):
            a = corrupt(text_truth, rng, 0.15)
            if a != top: alts.add(a)
        for a in sorted(alts, key=lambda s: (s != text_truth, s)):
            c1 = round(c1 * rng.uniform(0.5, 0.95), 3); cands.append(dict(string=a, confidence=c1))
        obs.append(dict(uuid=oid, boundingBox=bb, **nc, topCandidates=cands, _line=lines_idx, _x=x0, _truth=text_truth))
        truth[oid] = dict(text=text_truth, lines=lines_idx, top1_correct=(top == text_truth),
                          truth_in_candidates=any(c["string"] == text_truth for c in cands))
        return oid
    for i, line in enumerate(lines):
        segs = segments(line, rng, split_p)
        if not segs: pending_merge = None; continue
        y0 = my * H + (i + 1) * lh + lh * 0.12; y1 = y0 + lh * 0.76
        if pending_merge is not None and (len(segs) != 1 or pending_merge[0] != i - 1): pending_merge = None
        if pending_merge is not None and len(segs) == 1:      # merge this printed line into the previous observation (two lines, one obs)
            pi, po = pending_merge; pending_merge = None
            o = obs[-1]; a, b = segs[0]; t = o["_truth"] + " " + line[a:b]
            obs.pop(); del truth[po]
            oid = new_obs(t, min(o["_x"], mx * W + (2 + a) * cw), mx * W + (2 + max(b, len(lines[pi].rstrip()))) * cw,
                          my * H + (pi + 1) * lh + lh * 0.12, y1, [pi, i])
            gt_lines[-1]["segments"] = [s if s["observation_id"] != po else dict(s, observation_id=oid) for s in gt_lines[-1]["segments"]]
            gt_lines.append(dict(line_index=i, text=line.strip(), segments=[dict(observation_id=oid, char_start=a, char_end=b, merged=True)]))
            continue
        segl = []
        for a, b in segs:
            oid = new_obs(line[a:b], mx * W + (2 + a) * cw, mx * W + (2 + b) * cw, y0, y1, [i]); segl.append(dict(observation_id=oid, char_start=a, char_end=b))
        gt_lines.append(dict(line_index=i, text=line.strip(), segments=segl))
        if len(segs) == 1 and rng.random() < merge_p and i + 1 < len(lines): pending_merge = (i, segl[0]["observation_id"])
    # observation ordering as returned (Vision results are not guaranteed to be in reading order)
    mode = rng.choices([m for m, _ in ORDER_MODES], [w for _, w in ORDER_MODES])[0]
    def ctr(o): return (o["boundingBox"]["y"] + o["boundingBox"]["height"] / 2, o["boundingBox"]["x"])
    if mode == "row_major": obs.sort(key=lambda o: (-round(ctr(o)[0], 3), ctr(o)[1]))
    elif mode == "row_jitter":
        obs.sort(key=lambda o: (-(ctr(o)[0] + rng.uniform(-0.6, 0.6) * lh / H), ctr(o)[1]))
    elif mode == "column_major": obs.sort(key=lambda o: (o["_x"] > (mx * W + ncols * cw * 0.55), -ctr(o)[0]))
    else:
        obs.sort(key=lambda o: (-ctr(o)[0], ctr(o)[1])); blocks = [obs[j:j + 6] for j in range(0, len(obs), 6)]; rng.shuffle(blocks); obs = [o for b in blocks for o in b]
    reading = list(dict.fromkeys(s["observation_id"] for l in gt_lines for s in l["segments"]))
    top1 = {o["uuid"]: o["topCandidates"][0]["string"] for o in obs}
    # app_text: top candidates regrouped into printed lines (segments of one line joined by two spaces), reading order
    lines_out, seen = [], set()
    for l in gt_lines:
        parts = [top1[sg["observation_id"]] for sg in l["segments"] if sg["observation_id"] not in seen]
        seen |= {sg["observation_id"] for sg in l["segments"]}
        if parts: lines_out.append("  ".join(parts))
    app_text = "\n".join(lines_out)
    for o in obs: del o["_line"], o["_x"], o["_truth"]
    idx = {o["uuid"]: j for j, o in enumerate(obs)}   # ground truth refers to observations by index into vision.observations
    for l in gt_lines:
        l["segments"] = [dict(obs=idx[sg["observation_id"]], char_start=sg["char_start"], char_end=sg["char_end"], **({"merged": True} if sg.get("merged") else {})) for sg in l["segments"]]
    truth_list = [truth[o["uuid"]] for o in obs]
    reading = [idx[r] for r in reading]
    issues = sorted({"split_columns" if any(len(l["segments"]) > 1 for l in gt_lines) else "single_obs_lines"} |
                    ({"merged_lines"} if any(s.get("merged") for l in gt_lines for s in l["segments"]) else set()) |
                    ({"out_of_order"} if list(range(len(obs))) != reading else set()) |
                    ({"misread_top_candidate"} if not all(t["top1_correct"] for t in truth.values()) else set()) | ({"skew"} if skew else set()))
    return dict(id=f"O{k:05d}", source=dict(set="fixtures/large/receipts", receipt_id=rec["id"], file=rec["file"], variant=variant),
                capture=dict(image_width=W, image_height=H, skew_degrees=round(skew, 3), receipt_rect=dict(x=round(mx, 4), y=round(my, 4), width=round(1 - 2 * mx, 4), height=round(1 - 2 * my, 4)),
                             char_error_rate_param=err, column_split_probability=round(split_p, 3), order_mode=mode),
                vision=dict(request="VNRecognizeTextRequest", recognitionLevel="accurate", usesLanguageCorrection=rng.random() < 0.5,
                            coordinate_space="normalized, origin bottom-left", observations=obs),
                ground_truth=dict(lines=gt_lines, observations=truth_list, reading_order=reading,
                                  items=rec["items"], store=rec["store"], date=rec["date"], total=rec["total"]),
                app_text=app_text, issues=issues, synthetic=True)

def main():
    rng = random.Random(SEED4 + 200_000)
    recs = [json.loads(l) for l in open(os.path.join(FIXDIR, "large", "receipts", "expected_clean.jsonl"))]
    files = {os.path.basename(p).split("_")[0]: p for p in glob.glob(os.path.join(FIXDIR, "large", "receipts", "clean", "*", "*.txt"))}
    for r in recs: r["file"] = os.path.relpath(files[r["id"]], FIXDIR)
    plan = [(r, "capture_a") for r in recs] + [(r, "capture_b") for r in sorted(rng.sample(recs, 600), key=lambda r: r["id"])]
    rows = []
    for r, var in plan:
        rows.append(build(r, open(os.path.join(FIXDIR, r["file"]), encoding="utf-8").read(), rng, len(rows), var))
    for j in range(4): jdump(os.path.join(OUT, f"receipts_{j:03d}.jsonl"), rows[j * 750:(j + 1) * 750])
    from collections import Counter
    print(len(rows), sum(len(r["vision"]["observations"]) for r in rows), Counter(i for r in rows for i in r["issues"]), Counter(r["capture"]["order_mode"] for r in rows))

if __name__ == "__main__": main()
