from typing import Any

import google.adk.a2a.executor.a2a_agent_executor
from google.adk.a2a.converters.part_converter import (
    A2APartToGenAIPartConverter,
    convert_a2a_part_to_genai_part,
)
from google.adk.a2a.converters.request_converter import (
    convert_a2a_request_to_adk_run_args,
)
from x402_a2a.types import RequestContext


def override_convert_a2a_request_to_adk_run_args(
    request: RequestContext,
    part_converter: A2APartToGenAIPartConverter = convert_a2a_part_to_genai_part,
) -> dict[str, Any]:
    og = convert_a2a_request_to_adk_run_args(request, part_converter)
    if request.current_task and request.current_task.metadata:
        og["state_delta"] = {}
        for key, value in request.current_task.metadata.items():
            og["state_delta"][key] = value
    return og  # type: ignore[no-any-return]


# Monkey patch
google.adk.a2a.executor.a2a_agent_executor.convert_a2a_request_to_adk_run_args = (  # type: ignore[attr-defined]
    override_convert_a2a_request_to_adk_run_args
)

# IMPORTANT: Apply monkey patch BEFORE importing A2aAgentExecutor
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutor  # noqa: E402

MonkeyA2aAgentExecutor = A2aAgentExecutor
