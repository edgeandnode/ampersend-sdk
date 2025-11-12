import React, { useEffect, useRef, useState } from "react"

import "./App.css"

interface Message {
  role: "user" | "assistant"
  content: string
  toolCalls?: Array<{ name: string; args: string }>
  toolResults?: Array<{ content: string }>
}

const API_URL = "http://localhost:3001"

// LangChain icon component
const LangChainIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor" fillOpacity="0.9" />
    <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// User icon component
const UserIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path
      d="M6 21C6 17.134 8.686 14 12 14C15.314 14 18 17.134 18 21"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
)

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [tools, setTools] = useState<Array<{ name: string; description: string }>>([])
  const [serverStatus, setServerStatus] = useState<"checking" | "ready" | "error">("checking")
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Check server health and load tools on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${API_URL}/api/health`)
        const data = await response.json()
        setServerStatus(data.status === "ready" ? "ready" : "checking")
      } catch (error) {
        setServerStatus("error")
      }
    }

    const loadTools = async () => {
      try {
        const response = await fetch(`${API_URL}/api/tools`)
        const data = await response.json()
        setTools(data.tools || [])
      } catch (error) {
        console.error("Failed to load tools:", error)
      }
    }

    checkHealth()
    loadTools()

    // Poll health every 5 seconds if not ready
    const interval = setInterval(() => {
      if (serverStatus !== "ready") {
        checkHealth()
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [serverStatus])

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = { role: "user", content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: input,
          history: messages,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to send message")
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error("No response stream")
      }

      let assistantMessage: Message = { role: "assistant", content: "" }
      setMessages((prev) => [...prev, assistantMessage])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split("\n")

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === "content") {
                assistantMessage.content += data.content
                setMessages((prev) => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = { ...assistantMessage }
                  return newMessages
                })
              } else if (data.type === "tool_calls") {
                assistantMessage.toolCalls = data.tools
                setMessages((prev) => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = { ...assistantMessage }
                  return newMessages
                })
              } else if (data.type === "tool_result") {
                if (!assistantMessage.toolResults) {
                  assistantMessage.toolResults = []
                }
                assistantMessage.toolResults.push({ content: data.content })
                setMessages((prev) => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = { ...assistantMessage }
                  return newMessages
                })
              } else if (data.type === "done") {
                console.log("✅ Stream complete")
              } else if (data.type === "error") {
                console.error("Stream error:", data.error)
                assistantMessage.content += `\n\n❌ Error: ${data.error}`
                setMessages((prev) => {
                  const newMessages = [...prev]
                  newMessages[newMessages.length - 1] = { ...assistantMessage }
                  return newMessages
                })
              }
            } catch (e) {
              // Ignore parse errors for incomplete JSON
              console.debug("JSON parse error (might be incomplete):", e)
            }
          }
        }
      }
    } catch (error) {
      console.error("Error sending message:", error)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>LangChain Agent</h1>
        <div className="status-bar">
          <span className={`status-indicator ${serverStatus}`}>
            {serverStatus === "ready" && "Ready"}
            {serverStatus === "checking" && "Initializing"}
            {serverStatus === "error" && "Error"}
          </span>
          {tools.length > 0 && <span className="tools-count">{tools.length} tools available</span>}
        </div>
      </header>

      <div className="chat-container">
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome-message">
              <h2>Get started</h2>
              <p>This agent uses x402-enabled MCP tools with automatic payment handling.</p>
              {tools.length > 0 && (
                <div className="available-tools">
                  <h3>Available Tools:</h3>
                  <ul>
                    {tools.map((tool) => (
                      <li key={tool.name}>
                        <strong>{tool.name}</strong>: {tool.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="hint">Try asking: "What is 42 plus 17?"</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              <div className="message-avatar">{message.role === "user" ? <UserIcon /> : <LangChainIcon />}</div>
              <div className="message-content">
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="tool-calls">
                    {message.toolCalls.map((tool, idx) => (
                      <div key={idx} className="tool-call">
                        🔧 Using tool: <strong>{tool.name}</strong>
                        {tool.args && <pre className="tool-args">{tool.args}</pre>}
                      </div>
                    ))}
                  </div>
                )}
                {message.toolResults && message.toolResults.length > 0 && (
                  <div className="tool-results">
                    {message.toolResults.map((result, idx) => (
                      <div key={idx} className="tool-result">
                        ✅ Tool result: <pre className="tool-result-content">{result.content}</pre>
                      </div>
                    ))}
                  </div>
                )}
                <div className="message-text">{message.content}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="message assistant loading">
              <div className="message-avatar">
                <LangChainIcon />
              </div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message... (Press Enter to send)"
            disabled={isLoading || serverStatus !== "ready"}
            rows={3}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || serverStatus !== "ready"}
            className="send-button"
          >
            {isLoading ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
