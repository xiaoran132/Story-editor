"""SSE 帧编码：error 帧在异常携带 usage 时必须带出（Go 失败路径记账的契约）。"""
import unittest

from app.graph.story_graph import StreamPipelineError
from app.routers.generate import _sse_stream


class SSEErrorFrameTest(unittest.IsolatedAsyncioTestCase):

    async def test_error_frame_carries_usage(self) -> None:
        """StreamPipelineError 携带的已烧 usage 附进 error 帧，结构与 done 帧一致。"""

        async def src():
            yield {"type": "delta", "text": "hi"}
            raise StreamPipelineError(
                "RuntimeError: review down",
                {"write": {"prompt_tokens": 3, "completion_tokens": 4, "estimated": False},
                 "review": {}},
            )

        frames = [frame async for frame in _sse_stream(src())]

        self.assertTrue(frames[0].startswith("event: delta"))
        err = frames[1]
        self.assertTrue(err.startswith("event: error"))
        self.assertIn("RuntimeError: review down", err)
        self.assertIn('"completion_tokens": 4', err)

    async def test_plain_error_frame_has_no_usage(self) -> None:
        """普通异常没有 usage 可带，error 帧只有 detail——Go 侧按可选字段解析。"""

        async def src():
            yield {"type": "delta", "text": "x"}
            raise ValueError("nope")

        frames = [frame async for frame in _sse_stream(src())]

        self.assertEqual(len(frames), 2)
        self.assertTrue(frames[0].startswith("event: delta"))
        self.assertTrue(frames[1].startswith("event: error"))
        self.assertIn("ValueError: nope", frames[1])
        self.assertNotIn("usage", frames[1])


if __name__ == "__main__":
    unittest.main()
