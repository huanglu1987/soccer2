from __future__ import annotations

import re

import streamlit as st

from predictor_py import FIXED_COMPANIES, compute_rule_prediction


st.set_page_config(
    page_title="足球赔率预测器",
    page_icon="⚽",
    layout="centered",
)

SAMPLE_ROWS = [
    [1.72, 3.75, 4.85],
    [1.74, 3.70, 4.75],
    [1.73, 3.68, 4.90],
    [1.75, 3.72, 4.80],
    [1.70, 3.80, 4.95],
    [1.76, 3.69, 4.70],
]


def ensure_state() -> None:
    for index, company in enumerate(FIXED_COMPANIES):
        st.session_state.setdefault(f"paste_{index}", "")
        st.session_state.setdefault(f"home_{index}", "")
        st.session_state.setdefault(f"draw_{index}", "")
        st.session_state.setdefault(f"away_{index}", "")
    st.session_state.setdefault("match_name", "")
    st.session_state.setdefault("bulk_paste", "")


def extract_triplet(text: str) -> tuple[float, float, float] | None:
    matches = re.findall(r"\d+(?:\.\d+)?", text or "")
    if len(matches) < 3:
        return None
    numbers = [float(item) for item in matches[-3:]]
    return numbers[0], numbers[1], numbers[2]


def apply_triplet(index: int, triplet: tuple[float, float, float], raw: str = "") -> None:
    st.session_state[f"home_{index}"] = str(triplet[0])
    st.session_state[f"draw_{index}"] = str(triplet[1])
    st.session_state[f"away_{index}"] = str(triplet[2])
    if raw:
        st.session_state[f"paste_{index}"] = raw.strip()


def apply_bulk_paste() -> None:
    lines = [
        line.strip()
        for line in st.session_state["bulk_paste"].splitlines()
        if line.strip()
    ]
    applied = 0
    for index, line in enumerate(lines[: len(FIXED_COMPANIES)]):
        triplet = extract_triplet(line)
        if triplet:
            apply_triplet(index, triplet, line)
            applied += 1
    if applied:
        st.success(f"已应用 {applied} 行赔率。")
    else:
        st.warning("没有识别到可用的赔率行，请检查粘贴内容。")


def fill_sample() -> None:
    for index, row in enumerate(SAMPLE_ROWS):
        apply_triplet(index, (row[0], row[1], row[2]), " ".join(map(str, row)))
    st.session_state["match_name"] = "示例比赛"


def clear_form() -> None:
    for index, _company in enumerate(FIXED_COMPANIES):
        st.session_state[f"paste_{index}"] = ""
        st.session_state[f"home_{index}"] = ""
        st.session_state[f"draw_{index}"] = ""
        st.session_state[f"away_{index}"] = ""
    st.session_state["match_name"] = ""
    st.session_state["bulk_paste"] = ""


def collect_rows() -> list[dict]:
    rows = []
    for index, company in enumerate(FIXED_COMPANIES):
        paste_value = st.session_state[f"paste_{index}"].strip()
        if paste_value:
            triplet = extract_triplet(paste_value)
            if not triplet:
                raise ValueError(f"{company} 的整行赔率无法识别。")
            home, draw, away = triplet
        else:
            try:
                home = float(st.session_state[f"home_{index}"])
                draw = float(st.session_state[f"draw_{index}"])
                away = float(st.session_state[f"away_{index}"])
            except ValueError as exc:
                raise ValueError(f"{company} 的赔率还没填完整。") from exc

        rows.append({"company": company, "home": home, "draw": draw, "away": away})
    return rows


def render_result(result: dict, match_name: str) -> None:
    structure_label = result["confidenceProfile"]["label"]
    if result.get("abstained"):
        st.warning(f"推荐结果：{result['recommendation']}")
    else:
        st.success(f"推荐结果：{result['recommendation']}")
    st.caption(
        f"{match_name + ' · ' if match_name else ''}"
        f"信心等级：{result['confidence']} · 结构标签：{structure_label}"
    )

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("主胜", f"{result['finalProb']['home'] * 100:.1f}%")
        st.progress(float(result["finalProb"]["home"]))
    with col2:
        st.metric("平局", f"{result['finalProb']['draw'] * 100:.1f}%")
        st.progress(float(result["finalProb"]["draw"]))
    with col3:
        st.metric("客胜", f"{result['finalProb']['away'] * 100:.1f}%")
        st.progress(float(result["finalProb"]["away"]))

    st.markdown("### 结构摘要")
    meta1, meta2 = st.columns(2)
    with meta1:
        st.write(f"市场共识：{result['metrics']['consensus'] * 100:.1f}%")
        st.write(f"前二差值：{result['metrics']['topGap'] * 100:.1f}%")
    with meta2:
        st.write(f"最低赔一致度：{result['metrics']['favoriteVoteShare'] * 100:.1f}%")
        st.write(f"异常公司数：{result['metrics']['outlierCount']}")

    st.markdown("### 解释")
    st.write(result["explanation"])
    st.info(f"结构判读：{result['confidenceProfile']['note']}")


ensure_state()

st.title("足球赔率预测器")
st.caption("固定 6 家公司初始赔率，生成主平负概率、结构标签和解释。")

with st.container(border=True):
    st.text_input("比赛名称（可选）", key="match_name", placeholder="例如：阿森纳 vs 切尔西")
    st.text_area(
        "批量粘贴 1 到 6 行赔率",
        key="bulk_paste",
        height=120,
        placeholder="每行一家公司，例如\n1.72 3.75 4.85\n1.74 3.70 4.75",
    )
    action1, action2, action3 = st.columns(3)
    with action1:
        st.button("应用批量粘贴", use_container_width=True, on_click=apply_bulk_paste)
    with action2:
        st.button("填入示例", use_container_width=True, on_click=fill_sample)
    with action3:
        st.button("清空", use_container_width=True, on_click=clear_form)

with st.container(border=True):
    st.markdown("#### 固定公司录入")
    st.caption("可以直接粘贴整行赔率，也可以手动填写主胜 / 平局 / 客胜。")
    for index, company in enumerate(FIXED_COMPANIES):
        st.markdown(f"**{company}**")
        st.text_input(
            "整行粘贴",
            key=f"paste_{index}",
            placeholder="例如 1.72 3.75 4.85",
            label_visibility="collapsed",
        )
        col1, col2, col3 = st.columns(3)
        with col1:
            st.text_input("主胜", key=f"home_{index}")
        with col2:
            st.text_input("平局", key=f"draw_{index}")
        with col3:
            st.text_input("客胜", key=f"away_{index}")

with st.container(border=True):
    st.markdown("#### 预测结果")
    if st.button("生成预测", type="primary", use_container_width=True):
        try:
            rows = collect_rows()
            prediction = compute_rule_prediction(rows)
            render_result(prediction, st.session_state["match_name"].strip())
        except Exception as error:
            st.error(str(error))
    else:
        st.write("输入 6 家公司的初始赔率后点击“生成预测”。")
