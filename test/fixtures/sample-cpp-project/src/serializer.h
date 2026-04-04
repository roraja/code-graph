// Serialization framework — pluggable serializers for different wire formats.
// Template method pattern: base class defines serialize/deserialize flow,
// subclasses implement format-specific encoding.

#ifndef SERIALIZER_H
#define SERIALIZER_H

#include "message.h"
#include <memory>
#include <sstream>

// Serialization format identifier
enum class SerializationFormat {
  JSON,
  BINARY_PACKED,
  CSV,
  PROTOBUF_LIKE
};

// Abstract serializer — template method pattern
class ISerializer {
public:
  virtual ~ISerializer() = default;

  // Template method: serialize a message
  std::string serialize(const Message& message) {
    std::string result = writeHeader(message);
    result += writeBody(message);
    result += writeFooter(message);
    return result;
  }

  virtual SerializationFormat getFormat() const = 0;
  virtual std::string getContentType() const = 0;

protected:
  virtual std::string writeHeader(const Message& message) = 0;
  virtual std::string writeBody(const Message& message) = 0;
  virtual std::string writeFooter(const Message& message) = 0;
};

// JSON serializer
class JsonSerializer : public ISerializer {
public:
  SerializationFormat getFormat() const override;
  std::string getContentType() const override;

protected:
  std::string writeHeader(const Message& message) override;
  std::string writeBody(const Message& message) override;
  std::string writeFooter(const Message& message) override;

private:
  std::string escapeJson(const std::string& input) const;
  std::string priorityToString(Priority p) const;
  std::string typeToString(MessageType t) const;
};

// Compact binary serializer (length-prefixed fields)
class BinaryPackedSerializer : public ISerializer {
public:
  SerializationFormat getFormat() const override;
  std::string getContentType() const override;

protected:
  std::string writeHeader(const Message& message) override;
  std::string writeBody(const Message& message) override;
  std::string writeFooter(const Message& message) override;

private:
  void writeUint32(std::ostringstream& oss, uint32_t value) const;
  void writeLengthPrefixed(std::ostringstream& oss, const std::string& data) const;
};

// Serializer factory — creates serializer based on format
class SerializerFactory {
public:
  static std::unique_ptr<ISerializer> create(SerializationFormat format);
  static std::unique_ptr<ISerializer> createFromContentType(const std::string& contentType);
};

#endif // SERIALIZER_H
