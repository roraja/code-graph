// Router implementation — message routing, pub/sub, and observer notifications.
// This is the most complex file: pattern matching, multi-rule routing,
// dead letter handling, and observer cascade.

#include "router.h"
#include <algorithm>
#include <iostream>
#include <sstream>

// --- MessageRouter ---

MessageRouter::MessageRouter()
    : deadLetterTransport_(nullptr),
      deadLetterEnabled_(false),
      deadLetterCount_(0) {
}

MessageRouter::~MessageRouter() {
  clearRules();
}

// Route a message through all matching rules. For each matching rule,
// the message is sent via the rule's transport. If no rules match and
// dead letter queue is enabled, the message goes to dead letter.
std::vector<RouteOutcome> MessageRouter::route(const Message& message,
                                                const std::string& topic) {
  std::vector<RouteOutcome> outcomes;

  // First, validate the message
  if (!message.validate()) {
    if (deadLetterEnabled_) {
      sendToDeadLetter(message, "validation_failed");
    }
    outcomes.push_back(RouteOutcome{
        message.getId(), "validation", DeliveryResult{false, "Invalid message", 0, ""}, 0});
    return outcomes;
  }

  // Find all matching rules
  std::vector<const RouteRule*> matchedRules;
  for (const auto& rule : rules_) {
    if (matchesPattern(topic, rule.pattern)) {
      if (message.getPriority() >= rule.minPriority) {
        matchedRules.push_back(&rule);
      }
    }
  }

  // If no rules matched, try dead letter queue
  if (matchedRules.empty()) {
    if (deadLetterEnabled_) {
      sendToDeadLetter(message, "no_matching_route");
    }
    outcomes.push_back(RouteOutcome{
        message.getId(), "no_match", DeliveryResult{false, "No matching route", 0, topic}, 0});
    return outcomes;
  }

  // Send through each matching rule
  for (const auto* rule : matchedRules) {
    DeliveryResult result = rule->transport->send(message, rule->destination);

    outcomes.push_back(RouteOutcome{
        message.getId(),
        rule->pattern,
        result,
        static_cast<int>(matchedRules.size())
    });

    if (!result.success && deadLetterEnabled_) {
      sendToDeadLetter(message, "delivery_failed: " + result.error);
    }

    // Stop after first match if rule is exclusive
    if (rule->exclusive) {
      break;
    }
  }

  // Notify pub/sub subscribers
  notifySubscribers(message, topic);

  return outcomes;
}

void MessageRouter::addRule(const RouteRule& rule) {
  // Insert rules sorted by priority (higher priority patterns first)
  // Exclusive rules go before non-exclusive ones
  auto it = std::find_if(rules_.begin(), rules_.end(),
      [&rule](const RouteRule& existing) {
        if (rule.exclusive && !existing.exclusive) return true;
        if (!rule.exclusive && existing.exclusive) return false;
        return rule.minPriority > existing.minPriority;
      });
  rules_.insert(it, rule);
}

void MessageRouter::removeRule(const std::string& pattern) {
  rules_.erase(
      std::remove_if(rules_.begin(), rules_.end(),
          [&pattern](const RouteRule& rule) { return rule.pattern == pattern; }),
      rules_.end());
}

void MessageRouter::clearRules() {
  rules_.clear();
}

size_t MessageRouter::getRuleCount() const {
  return rules_.size();
}

std::string MessageRouter::subscribe(const std::string& subscriberId,
                                      const std::string& topicPattern,
                                      std::function<void(const Message&)> callback) {
  std::string subId = subscriberId + ":" + topicPattern;

  subscriptions_[subId] = Subscription{
      subscriberId, topicPattern, std::move(callback), true};

  // Notify observers
  for (auto* observer : observers_) {
    observer->onSubscribe(subscriberId, topicPattern);
  }

  return subId;
}

void MessageRouter::unsubscribe(const std::string& subscriptionId) {
  auto it = subscriptions_.find(subscriptionId);
  if (it != subscriptions_.end()) {
    // Notify observers before removing
    for (auto* observer : observers_) {
      observer->onUnsubscribe(it->second.subscriberId, it->second.topicPattern);
    }
    subscriptions_.erase(it);
  }
}

size_t MessageRouter::getSubscriptionCount() const {
  return subscriptions_.size();
}

void MessageRouter::addObserver(ISubscriptionObserver* observer) {
  observers_.push_back(observer);
}

void MessageRouter::removeObserver(ISubscriptionObserver* observer) {
  observers_.erase(
      std::remove(observers_.begin(), observers_.end(), observer),
      observers_.end());
}

void MessageRouter::enableDeadLetterQueue(ITransport* transport,
                                           const std::string& destination) {
  deadLetterTransport_ = transport;
  deadLetterDestination_ = destination;
  deadLetterEnabled_ = true;
}

size_t MessageRouter::getDeadLetterCount() const {
  return deadLetterCount_;
}

// Pattern matching: supports * as single-level wildcard and # as multi-level.
// Examples: "sensor.*" matches "sensor.temp" but not "sensor.temp.high"
//           "sensor.#" matches "sensor.temp" and "sensor.temp.high"
bool MessageRouter::matchesPattern(const std::string& topic,
                                    const std::string& pattern) const {
  if (pattern == "#" || pattern == "*") {
    return true;
  }

  if (pattern == topic) {
    return true;
  }

  // Split into segments
  std::vector<std::string> topicParts;
  std::vector<std::string> patternParts;

  std::istringstream topicStream(topic);
  std::istringstream patternStream(pattern);
  std::string segment;

  while (std::getline(topicStream, segment, '.')) {
    topicParts.push_back(segment);
  }
  while (std::getline(patternStream, segment, '.')) {
    patternParts.push_back(segment);
  }

  // Match segment by segment
  size_t ti = 0, pi = 0;
  while (ti < topicParts.size() && pi < patternParts.size()) {
    if (patternParts[pi] == "#") {
      return true;  // # matches everything after
    }
    if (patternParts[pi] == "*") {
      ti++;
      pi++;
      continue;
    }
    if (topicParts[ti] != patternParts[pi]) {
      return false;
    }
    ti++;
    pi++;
  }

  return ti == topicParts.size() && pi == patternParts.size();
}

void MessageRouter::notifySubscribers(const Message& message,
                                       const std::string& topic) {
  for (auto& pair : subscriptions_) {
    auto& sub = pair.second;
    if (!sub.active) {
      continue;
    }

    if (matchesPattern(topic, sub.topicPattern)) {
      bool deliverySuccess = true;
      try {
        sub.callback(message);
      } catch (...) {
        deliverySuccess = false;
      }

      // Notify observers about the delivery
      for (auto* observer : observers_) {
        observer->onDelivery(sub.subscriberId, message.getId(), deliverySuccess);
      }
    }
  }
}

void MessageRouter::notifyObservers(const std::string& event,
                                     const std::string& subscriberId,
                                     const std::string& detail) {
  // Generic notification — used internally
  for (auto* observer : observers_) {
    if (event == "subscribe") {
      observer->onSubscribe(subscriberId, detail);
    } else if (event == "unsubscribe") {
      observer->onUnsubscribe(subscriberId, detail);
    }
  }
}

void MessageRouter::sendToDeadLetter(const Message& message,
                                      const std::string& reason) {
  if (!deadLetterEnabled_ || !deadLetterTransport_) {
    return;
  }

  // Create a wrapper TextMessage with the original + reason
  TextMessage deadMsg(
      "DLQ|" + message.getId() + "|reason=" + reason,
      Priority::LOW);

  deadLetterTransport_->send(deadMsg, deadLetterDestination_);
  deadLetterCount_++;
}

// --- LoggingSubscriptionObserver ---

void LoggingSubscriptionObserver::onSubscribe(const std::string& subscriberId,
                                               const std::string& topic) {
  std::cout << "[SUB] " << subscriberId << " subscribed to " << topic << std::endl;
  eventCount_++;
}

void LoggingSubscriptionObserver::onUnsubscribe(const std::string& subscriberId,
                                                 const std::string& topic) {
  std::cout << "[UNSUB] " << subscriberId << " unsubscribed from " << topic << std::endl;
  eventCount_++;
}

void LoggingSubscriptionObserver::onDelivery(const std::string& subscriberId,
                                              const std::string& messageId,
                                              bool success) {
  std::cout << "[DELIVER] " << subscriberId << " msg=" << messageId
            << " success=" << (success ? "true" : "false") << std::endl;
  eventCount_++;
}

size_t LoggingSubscriptionObserver::getEventCount() const {
  return eventCount_;
}

// --- MetricsObserver ---

MetricsObserver::MetricsObserver()
    : totalDeliveries_(0), failedDeliveries_(0) {
}

void MetricsObserver::onSubscribe(const std::string& subscriberId,
                                   const std::string& topic) {
  activeSubscribers_.insert(subscriberId);
}

void MetricsObserver::onUnsubscribe(const std::string& subscriberId,
                                     const std::string& topic) {
  activeSubscribers_.erase(subscriberId);
}

void MetricsObserver::onDelivery(const std::string& subscriberId,
                                  const std::string& messageId,
                                  bool success) {
  totalDeliveries_++;
  if (!success) {
    failedDeliveries_++;
  }
}

size_t MetricsObserver::getTotalDeliveries() const {
  return totalDeliveries_;
}

size_t MetricsObserver::getFailedDeliveries() const {
  return failedDeliveries_;
}

double MetricsObserver::getSuccessRate() const {
  if (totalDeliveries_ == 0) {
    return 1.0;
  }
  return static_cast<double>(totalDeliveries_ - failedDeliveries_) /
         static_cast<double>(totalDeliveries_);
}
