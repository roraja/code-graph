// Middleware pipeline — chain-of-responsibility for message processing.
// Each middleware can inspect, transform, or reject messages before routing.
// Supports async-style middleware with next() chaining.

#ifndef MIDDLEWARE_H
#define MIDDLEWARE_H

#include "message.h"
#include <functional>
#include <deque>
#include <memory>

// Middleware result — controls pipeline flow
enum class MiddlewareAction {
  CONTINUE,   // Pass to next middleware
  SKIP,       // Skip remaining middleware, proceed to routing
  REJECT,     // Reject the message entirely
  TRANSFORM   // Message was transformed, continue with new version
};

struct MiddlewareResult {
  MiddlewareAction action;
  std::string reason;
  Message* transformedMessage;  // Non-null only if action == TRANSFORM
};

// Abstract middleware interface
class IMiddleware {
public:
  virtual ~IMiddleware() = default;
  virtual std::string getName() const = 0;
  virtual MiddlewareResult process(const Message& message) = 0;
  virtual int getPriority() const = 0;  // Lower = runs first
};

// Rate limiter middleware — rejects messages exceeding rate limits
class RateLimiterMiddleware : public IMiddleware {
public:
  RateLimiterMiddleware(int maxPerSecond, int burstSize);

  std::string getName() const override;
  MiddlewareResult process(const Message& message) override;
  int getPriority() const override;

  void reset();
  int getRejectedCount() const;

private:
  int maxPerSecond_;
  int burstSize_;
  int currentCount_;
  int rejectedCount_;
  int64_t windowStart_;

  bool isWithinLimit();
  void slideWindow();
};

// Authentication middleware — validates message credentials
class AuthMiddleware : public IMiddleware {
public:
  AuthMiddleware();

  std::string getName() const override;
  MiddlewareResult process(const Message& message) override;
  int getPriority() const override;

  void addApiKey(const std::string& key, const std::string& owner);
  void revokeApiKey(const std::string& key);
  bool isKeyValid(const std::string& key) const;

private:
  std::map<std::string, std::string> apiKeys_;  // key -> owner
  std::unordered_set<std::string> revokedKeys_;
};

// Compression middleware — compresses large payloads
class CompressionMiddleware : public IMiddleware {
public:
  CompressionMiddleware(size_t minSizeBytes);

  std::string getName() const override;
  MiddlewareResult process(const Message& message) override;
  int getPriority() const override;

  size_t getBytesCompressed() const;

private:
  size_t minSizeBytes_;
  size_t bytesCompressed_;

  std::string compress(const std::string& input) const;
};

// Middleware pipeline — runs message through all registered middleware
class MiddlewarePipeline {
public:
  MiddlewarePipeline();

  void addMiddleware(std::unique_ptr<IMiddleware> middleware);
  void removeMiddleware(const std::string& name);

  // Run message through pipeline. Returns final action and reason.
  MiddlewareResult execute(const Message& message);

  size_t getMiddlewareCount() const;
  std::vector<std::string> getMiddlewareNames() const;

private:
  std::vector<std::unique_ptr<IMiddleware>> middlewares_;

  void sortByPriority();
};

#endif // MIDDLEWARE_H
