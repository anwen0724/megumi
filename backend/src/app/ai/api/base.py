"""Protocol stream contract shared by provider factories; no SDK dependency."""

from typing import Protocol

from app.ai.messages import Transcript
from app.ai.model import Model
from app.ai.options import CallOptions, SimpleOptions
from app.ai.stream import AssistantResponse


class ProviderStreams(Protocol):
    """与 pi 相同: 协议接收模型、规范化历史、选项, 返回统一响应流。"""

    def stream(
        self, model: Model, context: Transcript, options: CallOptions | None = None
    ) -> AssistantResponse:
        """使用协议原生选项启动一次生成。"""
        ...

    def stream_simple(
        self, model: Model, context: Transcript, options: SimpleOptions | None = None
    ) -> AssistantResponse:
        """使用简化选项启动一次生成。"""
        ...
