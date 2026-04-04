// Implementation of message types.
// Handles serialization, validation, and data integrity for all message kinds.

#include "message.h"
#include <sstream>
#include <algorithm>
#include <random>
#include <iomanip>

// --- Message base class ---

Message::Message(MessageType type, Priority priority)
    : type_(type), priority_(priority), timestamp_(0) {
  id_ = generateId();
  auto now = std::chrono::system_clock::now();
  timestamp_ = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch()).count();
}

Message::~Message() {
}

MessageType Message::getType() const {
  return type_;
}

Priority Message::getPriority() const {
  return priority_;
}

std::string Message::getId() const {
  return id_;
}

int64_t Message::getTimestamp() const {
  return timestamp_;
}

void Message::setHeader(const std::string& key, const std::string& value) {
  headers_[key] = value;
}

std::string Message::getHeader(const std::string& key) const {
  auto it = headers_.find(key);
  if (it != headers_.end()) {
    return it->second;
  }
  return "";
}

std::string Message::generateId() {
  static std::mt19937 gen(std::random_device{}());
  static std::uniform_int_distribution<> dis(0, 15);
  const char* hex = "0123456789abcdef";
  std::string uuid;
  for (int i = 0; i < 32; i++) {
    uuid += hex[dis(gen)];
    if (i == 7 || i == 11 || i == 15 || i == 19) {
      uuid += '-';
    }
  }
  return uuid;
}

// --- TextMessage ---

TextMessage::TextMessage(const std::string& body, Priority priority)
    : Message(MessageType::TEXT, priority), body_(body) {
}

std::string TextMessage::serialize() const {
  std::ostringstream oss;
  oss << "TEXT|" << id_ << "|" << static_cast<int>(priority_) << "|" << body_;
  return oss.str();
}

bool TextMessage::validate() const {
  if (body_.empty()) {
    return false;
  }
  if (body_.length() > MAX_BODY_LENGTH) {
    return false;
  }
  // Check for null bytes in text
  if (body_.find('\0') != std::string::npos) {
    return false;
  }
  return true;
}

size_t TextMessage::payloadSize() const {
  return body_.size();
}

const std::string& TextMessage::getBody() const {
  return body_;
}

void TextMessage::setBody(const std::string& body) {
  body_ = body;
}

// --- BinaryMessage ---

BinaryMessage::BinaryMessage(std::vector<uint8_t> data, Priority priority)
    : Message(MessageType::BINARY, priority),
      data_(std::move(data)),
      checksum_(0),
      hasChecksum_(false) {
}

std::string BinaryMessage::serialize() const {
  std::ostringstream oss;
  oss << "BIN|" << id_ << "|" << data_.size() << "|";
  for (uint8_t byte : data_) {
    oss << std::hex << std::setfill('0') << std::setw(2) << static_cast<int>(byte);
  }
  if (hasChecksum_) {
    oss << "|CRC:" << std::hex << checksum_;
  }
  return oss.str();
}

bool BinaryMessage::validate() const {
  if (data_.empty()) {
    return false;
  }
  if (data_.size() > 10 * 1024 * 1024) {
    return false;  // Max 10 MB
  }
  if (hasChecksum_) {
    return verifyChecksum();
  }
  return true;
}

size_t BinaryMessage::payloadSize() const {
  return data_.size();
}

const std::vector<uint8_t>& BinaryMessage::getData() const {
  return data_;
}

void BinaryMessage::setChecksum(uint32_t checksum) {
  checksum_ = checksum;
  hasChecksum_ = true;
}

bool BinaryMessage::verifyChecksum() const {
  if (!hasChecksum_) {
    return true;
  }
  return computeChecksum() == checksum_;
}

uint32_t BinaryMessage::computeChecksum() const {
  uint32_t crc = 0xFFFFFFFF;
  for (uint8_t byte : data_) {
    crc ^= byte;
    for (int j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >> 1) ^ 0xEDB88320;
      } else {
        crc = crc >> 1;
      }
    }
  }
  return ~crc;
}

// --- CommandMessage ---

const std::vector<std::string> CommandMessage::ALLOWED_COMMANDS = {
    "subscribe", "unsubscribe", "publish", "ping", "status",
    "configure", "shutdown", "restart"
};

CommandMessage::CommandMessage(const std::string& command,
                               const std::map<std::string, std::string>& args)
    : Message(MessageType::COMMAND, Priority::HIGH),
      command_(command),
      args_(args) {
}

std::string CommandMessage::serialize() const {
  std::ostringstream oss;
  oss << "CMD|" << id_ << "|" << command_;
  for (const auto& pair : args_) {
    oss << "|" << pair.first << "=" << pair.second;
  }
  return oss.str();
}

bool CommandMessage::validate() const {
  if (command_.empty()) {
    return false;
  }
  // Check that command is in the allow-list
  bool found = false;
  for (const auto& allowed : ALLOWED_COMMANDS) {
    if (allowed == command_) {
      found = true;
      break;
    }
  }
  if (!found) {
    return false;
  }
  // Subscribe/unsubscribe require a "topic" argument
  if (command_ == "subscribe" || command_ == "unsubscribe") {
    if (!hasArg("topic")) {
      return false;
    }
  }
  return true;
}

size_t CommandMessage::payloadSize() const {
  size_t size = command_.size();
  for (const auto& pair : args_) {
    size += pair.first.size() + pair.second.size();
  }
  return size;
}

const std::string& CommandMessage::getCommand() const {
  return command_;
}

std::string CommandMessage::getArg(const std::string& key) const {
  auto it = args_.find(key);
  if (it != args_.end()) {
    return it->second;
  }
  return "";
}

bool CommandMessage::hasArg(const std::string& key) const {
  return args_.find(key) != args_.end();
}
