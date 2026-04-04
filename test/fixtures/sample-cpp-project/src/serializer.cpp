// Serializer implementations — JSON and binary-packed wire formats.

#include "serializer.h"
#include <iomanip>

// --- JsonSerializer ---

SerializationFormat JsonSerializer::getFormat() const {
  return SerializationFormat::JSON;
}

std::string JsonSerializer::getContentType() const {
  return "application/json";
}

std::string JsonSerializer::writeHeader(const Message& message) {
  std::ostringstream oss;
  oss << "{";
  oss << "\"id\":\"" << escapeJson(message.getId()) << "\",";
  oss << "\"type\":\"" << typeToString(message.getType()) << "\",";
  oss << "\"priority\":\"" << priorityToString(message.getPriority()) << "\",";
  oss << "\"timestamp\":" << message.getTimestamp() << ",";
  return oss.str();
}

std::string JsonSerializer::writeBody(const Message& message) {
  std::ostringstream oss;
  oss << "\"payload\":\"" << escapeJson(message.serialize()) << "\",";
  oss << "\"payloadSize\":" << message.payloadSize();
  return oss.str();
}

std::string JsonSerializer::writeFooter(const Message& message) {
  return "}";
}

std::string JsonSerializer::escapeJson(const std::string& input) const {
  std::string result;
  result.reserve(input.size() + 10);

  for (char ch : input) {
    switch (ch) {
      case '"':  result += "\\\""; break;
      case '\\': result += "\\\\"; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default:
        if (ch < 0x20) {
          // Control character — encode as \u00XX
          std::ostringstream oss;
          oss << "\\u" << std::hex << std::setfill('0') << std::setw(4) << static_cast<int>(ch);
          result += oss.str();
        } else {
          result += ch;
        }
        break;
    }
  }
  return result;
}

std::string JsonSerializer::priorityToString(Priority p) const {
  switch (p) {
    case Priority::LOW:      return "low";
    case Priority::NORMAL:   return "normal";
    case Priority::HIGH:     return "high";
    case Priority::CRITICAL: return "critical";
  }
  return "unknown";
}

std::string JsonSerializer::typeToString(MessageType t) const {
  switch (t) {
    case MessageType::TEXT:      return "text";
    case MessageType::BINARY:    return "binary";
    case MessageType::COMMAND:   return "command";
    case MessageType::EVENT:     return "event";
    case MessageType::HEARTBEAT: return "heartbeat";
  }
  return "unknown";
}

// --- BinaryPackedSerializer ---

SerializationFormat BinaryPackedSerializer::getFormat() const {
  return SerializationFormat::BINARY_PACKED;
}

std::string BinaryPackedSerializer::getContentType() const {
  return "application/octet-stream";
}

std::string BinaryPackedSerializer::writeHeader(const Message& message) {
  std::ostringstream oss;
  // Magic bytes
  oss.put(0x43); // 'C'
  oss.put(0x47); // 'G'
  // Version
  oss.put(0x01);
  // Message type
  oss.put(static_cast<char>(message.getType()));
  // Priority
  oss.put(static_cast<char>(message.getPriority()));
  // Message ID (length-prefixed)
  writeLengthPrefixed(oss, message.getId());
  // Timestamp
  int64_t ts = message.getTimestamp();
  for (int i = 7; i >= 0; i--) {
    oss.put(static_cast<char>((ts >> (i * 8)) & 0xFF));
  }
  return oss.str();
}

std::string BinaryPackedSerializer::writeBody(const Message& message) {
  std::ostringstream oss;
  std::string payload = message.serialize();
  writeUint32(oss, static_cast<uint32_t>(payload.size()));
  oss << payload;
  return oss.str();
}

std::string BinaryPackedSerializer::writeFooter(const Message& message) {
  std::ostringstream oss;
  // CRC placeholder — in real impl, compute over header+body
  writeUint32(oss, 0x00000000);
  // End marker
  oss.put(0xFF);
  oss.put(0xFE);
  return oss.str();
}

void BinaryPackedSerializer::writeUint32(std::ostringstream& oss, uint32_t value) const {
  oss.put(static_cast<char>((value >> 24) & 0xFF));
  oss.put(static_cast<char>((value >> 16) & 0xFF));
  oss.put(static_cast<char>((value >> 8) & 0xFF));
  oss.put(static_cast<char>(value & 0xFF));
}

void BinaryPackedSerializer::writeLengthPrefixed(std::ostringstream& oss,
                                                  const std::string& data) const {
  writeUint32(oss, static_cast<uint32_t>(data.size()));
  oss << data;
}

// --- SerializerFactory ---

std::unique_ptr<ISerializer> SerializerFactory::create(SerializationFormat format) {
  switch (format) {
    case SerializationFormat::JSON:
      return std::make_unique<JsonSerializer>();
    case SerializationFormat::BINARY_PACKED:
      return std::make_unique<BinaryPackedSerializer>();
    case SerializationFormat::CSV:
    case SerializationFormat::PROTOBUF_LIKE:
      // Not yet implemented — fall through to JSON
      return std::make_unique<JsonSerializer>();
  }
  return std::make_unique<JsonSerializer>();
}

std::unique_ptr<ISerializer> SerializerFactory::createFromContentType(
    const std::string& contentType) {
  if (contentType == "application/json" || contentType == "text/json") {
    return create(SerializationFormat::JSON);
  }
  if (contentType == "application/octet-stream") {
    return create(SerializationFormat::BINARY_PACKED);
  }
  // Default to JSON
  return create(SerializationFormat::JSON);
}
