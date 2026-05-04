# 🌌 Vibes

**Vibes** is a high-performance, autonomous TUI (Terminal User Interface) harness designed for the **Gemma4 26B** model. It empowers you to manage complex missions by breaking them down into actionable milestones and tasks, all within a sleek, interactive terminal environment.

Built with **Ink 5** and **React 18**, Vibes connects to a remote Ollama instance to provide a state-of-the-art agentic experience with hierarchical planning and DAG-based autonomous scheduling.

---

## ✨ Features

- **🎯 Hierarchical Mission Planning**: Automatically break down high-level missions into milestones and actionable tasks using Gemma4's 32K context window.
- **🤖 Autonomous Agent Loop**: Executes individual tasks with a robust loop, supporting tool calls, streaming responses, and reasoning-first thinking.
- **📅 DAG-Based Scheduler**: Manages task dependencies, parallel execution (up to 2 concurrent tasks), and auto-discovery of new tasks during execution.
- **📟 Interactive TUI**: A premium terminal experience featuring:
  - **Dashboard**: High-level progress and statistics.
  - **Mission View**: Tree structure of missions, milestones, and tasks.
  - **Task View**: Live agent output with grouped tool call visualization.
  - **Status Bar**: Real-time monitoring of model stats, token usage, and active tasks.
- **🛠️ Integrated Toolset**: Native support for file operations (`read`, `write`, `edit`, `glob`, `grep`), shell command execution, and directory listing.

---

## 🧠 Model Flexibility

While **Vibes** was built to leverage the specific reasoning and tool-calling strengths of **Gemma4**, its underlying architecture is model-agnostic. 

- **OpenAI Compatibility**: Vibes uses the OpenAI SDK to communicate with Ollama, making it compatible with a wide range of models.
- **Thinking/Reasoning**: Supports models that provide a `reasoning` field in their response (like Gemma4 and DeepSeek R1).
- **Tool Calling**: Works with any model that supports standard OpenAI tool call formatting.

To switch models, simply update `OLLAMA_MODEL` and `OLLAMA_BASE_URL` in your `.env` file.

---


### Prerequisites

- **Node.js**: v18.0.0 or higher
- **Ollama**: Access to an Ollama instance. While Vibes is optimized for **Gemma4 26B** (`VladimirGav/gemma4-26b-16GB-VRAM:latest`), it is compatible with any model that supports OpenAI-style tool calling (e.g., Llama 3.1, Mistral, DeepSeek) by simply updating the `.env` configuration.


### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/vibes.git
   cd vibes
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   Create a `.env` file in the root directory (see `.env.example` if available):
   ```env
   OLLAMA_BASE_URL=https://your-ollama-endpoint/v1
   OLLAMA_MODEL=VladimirGav/gemma4-26b-16GB-VRAM:latest
   OLLAMA_API_KEY=ollama
   CONTEXT_WINDOW=32768
   ```

### Running Vibes

- **Development Mode** (with hot reload):
  ```bash
  npm run dev
  ```

- **Production Build**:
  ```bash
  npm run build
  npm start
  ```

- **Direct Execution** (using tsx):
  ```bash
  tsx src/index.tsx
  ```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `M` | Switch to **Missions** view |
| `T` | Switch to **Tasks** view |
| `A` | Switch to **Agent** output view |
| `S` | Open **Settings** |
| `N` | Create a **New Mission** |
| `P` | **Pause/Resume** the scheduler |
| `Q` / `Ctrl+C` | **Quit** the application |
| `Tab` | Cycle focus between panels |
| `↑/↓` | Navigate through lists |

---

## 🏗️ Architecture

- **`src/index.tsx`**: Entry point and TUI initialization.
- **`src/agent/`**: The brain of Vibes, containing the mission planner, task executor, and autonomous scheduler.
- **`src/tui/`**: React-based terminal components using Ink.
- **`src/tools/`**: A registry of Zod-validated tools for the agent to interact with the system.

---

## 📝 License

This project is licensed under the [MIT License](LICENSE.md).

---

*Built with ❤️ for the Gemma community.*
