import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional, override

from a2a.types import Message, Part, Role, TaskStatusUpdateEvent, TextPart
from google.adk.a2a.executor.a2a_agent_executor import A2aAgentExecutorConfig, logger
from google.adk.runners import Runner
from x402_a2a import x402ExtensionConfig
from x402_a2a.types import (
    AgentExecutor,
    EventQueue,
    RequestContext,
    TaskState,
    TaskStatus,
)

from .a2a_monkey import MonkeyA2aAgentExecutor
from .facilitator_x402_server_executor import FacilitatorX402ServerExecutor
from .x402_server_executor import X402ServerExecutor


class X402A2aAgentExecutor(AgentExecutor):
    def __init__(
        self,
        *,
        runner: Runner | Callable[..., Runner | Awaitable[Runner]],
        config: Optional[A2aAgentExecutorConfig] = None,
        x402_executor_class: type[X402ServerExecutor] = FacilitatorX402ServerExecutor,
        **kwargs: Any,
    ):
        inner = InnerA2aAgentExecutor(runner=runner, config=config, **kwargs)
        x402 = x402_executor_class(config=x402ExtensionConfig(), delegate=inner)
        # TODO: fix typing in x402-a2a
        self._executor = OuterA2aAgentExecutor(delegate=x402)  # type: ignore[arg-type]

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        await self._executor.execute(context, event_queue)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        await self._executor.cancel(context, event_queue)


class OuterA2aAgentExecutor(AgentExecutor):
    def __init__(
        self,
        *,
        delegate: AgentExecutor,
        **kwargs: Any,
    ):
        super().__init__(**kwargs)
        self._delegate = delegate

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        await self._delegate.cancel(context, event_queue)

    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        if not context.message:
            raise ValueError("A2A request must have a message")

        assert context.task_id, "A2A request must have a task ID"
        assert context.context_id, "A2A request must have a context ID"

        # for new task, create a task submitted event
        if not context.current_task:
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    task_id=context.task_id,
                    status=TaskStatus(
                        state=TaskState.submitted,
                        message=context.message,
                        timestamp=datetime.now(timezone.utc).isoformat(),
                    ),
                    context_id=context.context_id,
                    final=False,
                )
            )
        try:
            await self._delegate.execute(context, event_queue)
        except Exception as e:
            logger.error("Error handling A2A request: %s", e, exc_info=True)
            # Publish failure event
            try:
                await event_queue.enqueue_event(
                    TaskStatusUpdateEvent(
                        task_id=context.task_id,
                        status=TaskStatus(
                            state=TaskState.failed,
                            timestamp=datetime.now(timezone.utc).isoformat(),
                            message=Message(
                                message_id=str(uuid.uuid4()),
                                role=Role.agent,
                                parts=[Part(TextPart(text=str(e)))],
                            ),
                        ),
                        context_id=context.context_id,
                        final=True,
                    )
                )
            except Exception as enqueue_error:
                logger.error(
                    "Failed to publish failure event: %s", enqueue_error, exc_info=True
                )


class InnerA2aAgentExecutor(MonkeyA2aAgentExecutor):
    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        await self._handle_request(context, event_queue)
