## Agent Rules

### 功能开发工作流 (Feature Development Workflow)

Whenever the user requests to develop a new feature or start a significant coding task, you MUST automatically invoke and follow the instructions from the following skills in this order:

1. **grill-with-docs**: First, clarify requirements, resolve design decisions, and ensure all ambiguities are addressed before proceeding.
2. **writing-beats**: Second, break down the implementation plan into smaller, manageable "beats" or steps.
3. **tdd**: Finally, execute the implementation following Test-Driven Development principles (Red-Green-Refactor).

Do not skip these steps. Explicitly acknowledge to the user that you are applying this workflow for feature development.
