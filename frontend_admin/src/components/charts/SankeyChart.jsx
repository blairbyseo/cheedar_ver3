/**
 * Sankey 다이어그램 — 사용자 동선(페이지 전환) 시각화.
 *
 * Cheddar_Team_26 의 SankeyChart 를 옮긴 것. 원본은 Tailwind 유틸 클래스를
 * 썼는데, 이 관리자 앱은 Tailwind 가 없어 레이아웃에 필요한 부분만 inline
 * style 로 바꿨다(SVG 자체는 속성 기반이라 그대로 동작).
 *
 * @param {Array} data  [{ from, to, value }] 형태의 엣지 배열
 */
import { useEffect, useMemo, useRef, useState } from "react";

export function SankeyChart({ data, nodeWidth = 15, nodePadding = 10 }) {
  const containerRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 300 });
  const [hoveredLink, setHoveredLink] = useState(null);

  // 컨테이너 크기 감지(반응형).
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({
          width: Math.max(rect.width - 40, 600),
          height: Math.max(rect.height - 20, 250),
        });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // 노드(왼쪽=출발 / 오른쪽=도착)와 링크 계산.
  const { leftNodes, rightNodes, links, maxLinkValue } = useMemo(() => {
    if (!data || data.length === 0) {
      return { leftNodes: [], rightNodes: [], links: [], maxLinkValue: 1 };
    }

    const nodeMap = new Map();
    const nodeInflow = {};
    const nodeOutflow = {};

    data.forEach(({ from, to, value }) => {
      if (!nodeMap.has(from)) {
        nodeMap.set(from, { name: from });
        nodeOutflow[from] = 0;
        nodeInflow[from] = 0;
      }
      if (!nodeMap.has(to)) {
        nodeMap.set(to, { name: to });
        nodeOutflow[to] = 0;
        nodeInflow[to] = 0;
      }
      nodeOutflow[from] = (nodeOutflow[from] || 0) + value;
      nodeInflow[to] = (nodeInflow[to] || 0) + value;
    });

    const nodeValues = {};
    nodeMap.forEach((_node, name) => {
      nodeValues[name] = (nodeInflow[name] || 0) + (nodeOutflow[name] || 0);
    });

    const leftSet = new Set();
    const rightSet = new Set();
    data.forEach(({ from, to }) => {
      if (!rightSet.has(from)) leftSet.add(from);
      if (!leftSet.has(to)) rightSet.add(to);
    });

    // 양쪽 모두 속한 노드: 출력이 많으면 왼쪽, 입력이 많으면 오른쪽.
    nodeMap.forEach((_node, name) => {
      if (leftSet.has(name) && rightSet.has(name)) {
        if (nodeOutflow[name] >= nodeInflow[name]) rightSet.delete(name);
        else leftSet.delete(name);
      }
    });

    const left = Array.from(leftSet)
      .map((name) => ({ name, value: nodeValues[name] }))
      .sort((a, b) => b.value - a.value);
    const right = Array.from(rightSet)
      .map((name) => ({ name, value: nodeValues[name] }))
      .sort((a, b) => b.value - a.value);

    const linksArray = data.map(({ from, to, value }, index) => ({
      id: index,
      sourceName: from,
      targetName: to,
      value,
    }));
    const maxLink = Math.max(...linksArray.map((l) => l.value), 1);

    return { leftNodes: left, rightNodes: right, links: linksArray, maxLinkValue: maxLink };
  }, [data]);

  const actualWidth = containerSize.width;
  const actualHeight = containerSize.height;
  const leftX = 120;
  const rightX = actualWidth - 120 - nodeWidth;

  const calculateNodePositions = (nodeList, totalHeight) => {
    if (nodeList.length === 0) return [];
    const totalValue = nodeList.reduce((sum, node) => sum + node.value, 0);
    const scale = totalHeight / Math.max(totalValue, 1);
    let yPos = 0;
    return nodeList.map((node) => {
      const nodeHeight = Math.max(node.value * scale, 20);
      const y = yPos;
      yPos += nodeHeight + nodePadding;
      return { ...node, y, height: nodeHeight };
    });
  };

  const availableHeight =
    actualHeight - (Math.max(leftNodes.length, rightNodes.length) - 1) * nodePadding;
  const leftNodesWithPos = calculateNodePositions(leftNodes, availableHeight);
  const rightNodesWithPos = calculateNodePositions(rightNodes, availableHeight);

  const calculateLinkPath = (link) => {
    const sourceNode = leftNodesWithPos.find((n) => n.name === link.sourceName);
    const targetNode = rightNodesWithPos.find((n) => n.name === link.targetName);
    if (!sourceNode || !targetNode) return null;

    const sourceX = leftX + nodeWidth;
    const sourceY = sourceNode.y + sourceNode.height / 2;
    const targetX = rightX;
    const targetY = targetNode.y + targetNode.height / 2;
    const midX = (sourceX + targetX) / 2;

    return {
      path: `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`,
      sourceY,
      targetY,
      value: link.value,
      sourceName: link.sourceName,
      targetName: link.targetName,
    };
  };

  if (leftNodes.length === 0 && rightNodes.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
        }}
      >
        데이터가 없습니다.
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "auto" }}>
      <svg
        width={actualWidth}
        height={actualHeight}
        viewBox={`0 0 ${actualWidth} ${actualHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="linkGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3182F6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* 링크 */}
        {links.map((link) => {
          const linkPath = calculateLinkPath(link);
          if (!linkPath) return null;
          const linkWidth = Math.max(3, (link.value / maxLinkValue) * 25);
          const isHovered = hoveredLink === link.id;

          return (
            <g key={link.id}>
              <path
                d={linkPath.path}
                fill="none"
                stroke="url(#linkGradient)"
                strokeWidth={linkWidth}
                opacity={isHovered ? 1 : 0.6}
              />
              <path
                d={linkPath.path}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(linkWidth + 10, 20)}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredLink(link.id)}
                onMouseLeave={() => setHoveredLink(null)}
              />
              {isHovered && (
                <g>
                  <rect
                    x={(leftX + rightX) / 2 - 60}
                    y={Math.min(linkPath.sourceY, linkPath.targetY) - 40}
                    width="120"
                    height="35"
                    fill="rgba(0, 0, 0, 0.8)"
                    rx="4"
                  />
                  <text
                    x={(leftX + rightX) / 2}
                    y={Math.min(linkPath.sourceY, linkPath.targetY) - 18}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="10"
                    fill="white"
                  >
                    {linkPath.sourceName} → {linkPath.targetName}: {linkPath.value}회
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* 왼쪽 노드 */}
        {leftNodesWithPos.map((node, index) => (
          <g key={`left-${index}`}>
            <rect x={leftX} y={node.y} width={nodeWidth} height={node.height} fill="#3182F6" rx={2} />
            <text
              x={leftX - 10}
              y={node.y + node.height / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="11"
              fill="#64748B"
              style={{ pointerEvents: "none" }}
            >
              {node.name}
            </text>
          </g>
        ))}

        {/* 오른쪽 노드 */}
        {rightNodesWithPos.map((node, index) => (
          <g key={`right-${index}`}>
            <rect x={rightX} y={node.y} width={nodeWidth} height={node.height} fill="#3182F6" rx={2} />
            <text
              x={rightX + nodeWidth + 10}
              y={node.y + node.height / 2}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize="11"
              fill="#64748B"
              style={{ pointerEvents: "none" }}
            >
              {node.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
