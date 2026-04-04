// Middleware pipeline implementation.
// Chain-of-responsibility with rate limiting, auth, and compression.

#include "middleware.h"
#include <algorithm>
#include <chrono>
#include <iostream>

// --- RateLimiterMiddleware ---

RateLimiterMiddleware::RateLimiterMiddleware(int maxPerSecond, int burstSize)
    : maxPerSecond_(maxPerSecond),
      burstSize_(burstSize),
      currentCount_(0),
      rejectedCount_(0),
      windowStart_(0) {
  auto now = std::chrono::steady_clock::now();
  windowStart_ = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch()).count();
}

std::string RateLimiterMiddleware::getName() const {
  return "RateLimiter";
}

MiddlewareResult RateLimiterMiddleware::process(const Message& message) {
  slideWindow();

  // Critical messages bypass rate limiting
  if (message.getPriority() == Priority::CRITICAL) {
    currentCount_++;
    return MiddlewareResult{MiddlewareAction::CONTINUE, "", nullptr};
  }

  if (!isWithinLimit()) {
    rejectedCount_++;
    return MiddlewareResult{
        MiddlewareAction::REJECT,
        "Rate limit exceeded: " + std::to_string(currentCount_) + "/" + std::to_string(maxPerSecond_),
        nullptr
    };
  }

  currentCount_++;
  return MiddlewareResult{MiddlewareAction::CONTINUE, "", nullptr};
}

int RateLimiterMiddleware::getPriority() const {
  return 10;  // Run early
}

void RateLimiterMiddleware::reset() {
  currentCount_ = 0;
  rejectedCount_ = 0;
}

int RateLimiterMiddleware::getRejectedCount() const {
  return rejectedCount_;
}

bool RateLimiterMiddleware::isWithinLimit() {
  if (currentCount_ < burstSize_) {
    return true;  // Within burst allowance
  }
  return currentCount_ < maxPerSecond_;
}

void RateLimiterMiddleware::slideWindow() {
  auto now = std::chrono::steady_clock::now();
  int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
      now.time_since_epoch()).count();

  if (nowMs - windowStart_ >= 1000) {
    // New window — reset counter
    currentCount_ = 0;
    windowStart_ = nowMs;
  }
}

// --- AuthMiddleware ---

AuthMiddleware::AuthMiddleware() {
}

std::string AuthMiddleware::getName() const {
  return "Auth";
}

MiddlewareResult AuthMiddleware::process(const Message& message) {
  // Heartbeat messages don't need auth
  if (message.getType() == MessageType::HEARTBEAT) {
    return MiddlewareResult{MiddlewareAction::CONTINUE, "", nullptr};
  }

  std::string apiKey = message.getHeader("X-API-Key");

  if (apiKey.empty()) {
    // No API key — check if message type allows anonymous
    if (message.getType() == MessageType::TEXT && message.getPriority() == Priority::LOW) {
      return MiddlewareResult{MiddlewareAction::CONTINUE, "anonymous_allowed", nullptr};
    }
    return MiddlewareResult{
        MiddlewareAction::REJECT, "Missing API key", nullptr};
  }

  // Check if key is revoked
  if (revokedKeys_.count(apiKey) > 0) {
    return MiddlewareResult{
        MiddlewareAction::REJECT, "Revoked API key", nullptr};
  }

  // Validate key exists
  if (!isKeyValid(apiKey)) {
    return MiddlewareResult{
        MiddlewareAction::REJECT, "Invalid API key", nullptr};
  }

  return MiddlewareResult{MiddlewareAction::CONTINUE, "", nullptr};
}

int AuthMiddleware::getPriority() const {
  return 5;  // Run very early — before rate limiting
}

void AuthMiddleware::addApiKey(const std::string& key, const std::string& owner) {
  apiKeys_[key] = owner;
}

void AuthMiddleware::revokeApiKey(const std::string& key) {
  revokedKeys_.insert(key);
}

bool AuthMiddleware::isKeyValid(const std::string& key) const {
  return apiKeys_.find(key) != apiKeys_.end();
}

// --- CompressionMiddleware ---

CompressionMiddleware::CompressionMiddleware(size_t minSizeBytes)
    : minSizeBytes_(minSizeBytes), bytesCompressed_(0) {
}

std::string CompressionMiddleware::getName() const {
  return "Compression";
}

MiddlewareResult CompressionMiddleware::process(const Message& message) {
  // Only compress large text messages
  if (message.getType() != MessageType::TEXT) {
    return MiddlewareResult{MiddlewareAction::CONTINUE, "", nullptr};
  }

  if (message.payloadSize() < minSizeBytes_) {
    return MiddlewareResult{MiddlewareAction::CONTINUE, "", nullptr};
  }

  // In a real implementation, we'd create a compressed version of the message.
  // For now, we just track that compression would apply.
  bytesCompressed_ += message.payloadSize();

  return MiddlewareResult{MiddlewareAction::CONTINUE, "compressed", nullptr};
}

int CompressionMiddleware::getPriority() const {
  return 50;  // Run late — after auth and rate limiting
}

size_t CompressionMiddleware::getBytesCompressed() const {
  return bytesCompressed_;
}

std::string CompressionMiddleware::compress(const std::string& input) const {
  // Simplified RLE compression for demonstration
  std::string result;
  size_t i = 0;
  while (i < input.size()) {
    char current = input[i];
    int count = 1;
    while (i + count < input.size() && input[i + count] == current && count < 255) {
      count++;
    }
    if (count > 3) {
      result += '#';
      result += static_cast<char>(count);
      result += current;
    } else {
      for (int j = 0; j < count; j++) {
        result += current;
      }
    }
    i += count;
  }
  return result;
}

// --- MiddlewarePipeline ---

MiddlewarePipeline::MiddlewarePipeline() {
}

void MiddlewarePipeline::addMiddleware(std::unique_ptr<IMiddleware> middleware) {
  middlewares_.push_back(std::move(middleware));
  sortByPriority();
}

void MiddlewarePipeline::removeMiddleware(const std::string& name) {
  middlewares_.erase(
      std::remove_if(middlewares_.begin(), middlewares_.end(),
          [&name](const std::unique_ptr<IMiddleware>& mw) {
            return mw->getName() == name;
          }),
      middlewares_.end());
}

MiddlewareResult MiddlewarePipeline::execute(const Message& message) {
  for (auto& mw : middlewares_) {
    MiddlewareResult result = mw->process(message);

    switch (result.action) {
      case MiddlewareAction::REJECT:
        // Stop pipeline — message rejected
        return result;

      case MiddlewareAction::SKIP:
        // Skip remaining middleware
        return MiddlewareResult{MiddlewareAction::CONTINUE, "skipped_remaining", nullptr};

      case MiddlewareAction::TRANSFORM:
        // In a full implementation, we'd pass the transformed message
        // to subsequent middleware. For now, continue.
        break;

      case MiddlewareAction::CONTINUE:
        // Normal flow — next middleware
        break;
    }
  }

  return MiddlewareResult{MiddlewareAction::CONTINUE, "pipeline_complete", nullptr};
}

size_t MiddlewarePipeline::getMiddlewareCount() const {
  return middlewares_.size();
}

std::vector<std::string> MiddlewarePipeline::getMiddlewareNames() const {
  std::vector<std::string> names;
  for (const auto& mw : middlewares_) {
    names.push_back(mw->getName());
  }
  return names;
}

void MiddlewarePipeline::sortByPriority() {
  std::sort(middlewares_.begin(), middlewares_.end(),
      [](const std::unique_ptr<IMiddleware>& a, const std::unique_ptr<IMiddleware>& b) {
        return a->getPriority() < b->getPriority();
      });
}
