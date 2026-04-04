// Message types and base message class for the messaging system.
// Defines the core data structures exchanged between components.

#ifndef MESSAGE_H
#define MESSAGE_H

#include <string>
#include <map>
#include <vector>
#include <memory>
#include <chrono>

// Priority levels for message routing
enum class Priority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3
};

// Message types for the discriminated dispatch system
enum class MessageType {
  TEXT,
  BINARY,
  COMMAND,
  EVENT,
  HEARTBEAT
};

// Base message class — all messages in the system inherit from this
class Message {
public:
  Message(MessageType type, Priority priority);
  virtual ~Message();

  virtual std::string serialize() const = 0;
  virtual bool validate() const = 0;
  virtual size_t payloadSize() const = 0;

  MessageType getType() const;
  Priority getPriority() const;
  std::string getId() const;
  int64_t getTimestamp() const;

  void setHeader(const std::string& key, const std::string& value);
  std::string getHeader(const std::string& key) const;

protected:
  MessageType type_;
  Priority priority_;
  std::string id_;
  int64_t timestamp_;
  std::map<std::string, std::string> headers_;

  std::string generateId();
};

// Text message for human-readable content
class TextMessage : public Message {
public:
  TextMessage(const std::string& body, Priority priority = Priority::NORMAL);

  std::string serialize() const override;
  bool validate() const override;
  size_t payloadSize() const override;

  const std::string& getBody() const;
  void setBody(const std::string& body);

private:
  std::string body_;
  static const size_t MAX_BODY_LENGTH = 65536;
};

// Binary message for raw data transfer
class BinaryMessage : public Message {
public:
  BinaryMessage(std::vector<uint8_t> data, Priority priority = Priority::NORMAL);

  std::string serialize() const override;
  bool validate() const override;
  size_t payloadSize() const override;

  const std::vector<uint8_t>& getData() const;
  void setChecksum(uint32_t checksum);
  bool verifyChecksum() const;

private:
  std::vector<uint8_t> data_;
  uint32_t checksum_;
  bool hasChecksum_;

  uint32_t computeChecksum() const;
};

// Command message for RPC-style operations
class CommandMessage : public Message {
public:
  CommandMessage(const std::string& command, const std::map<std::string, std::string>& args);

  std::string serialize() const override;
  bool validate() const override;
  size_t payloadSize() const override;

  const std::string& getCommand() const;
  std::string getArg(const std::string& key) const;
  bool hasArg(const std::string& key) const;

private:
  std::string command_;
  std::map<std::string, std::string> args_;
  static const std::vector<std::string> ALLOWED_COMMANDS;
};

#endif // MESSAGE_H
