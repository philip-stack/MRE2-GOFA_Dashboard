// Copyright 2020 ROS2-Control Development Team
// Modifications Copyright 2022 PickNik Inc
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#pragma once

#include <abb_egm_rws_managers/egm_manager.h>
#include <abb_egm_rws_managers/rws_manager.h>
#include <abb_hardware_interface/visibility_control.h>

#include <chrono>
#include <cmath>
#include <limits>
#include <memory>
#include <string>
#include <vector>

#include <abb_egm_msgs/msg/egm_channel_state.hpp>
#include <abb_egm_msgs/msg/egm_state.hpp>
#include <geometry_msgs/msg/pose_stamped.hpp>
#include <hardware_interface/handle.hpp>
#include <hardware_interface/hardware_info.hpp>
#include <hardware_interface/system_interface.hpp>
#include <hardware_interface/types/hardware_interface_return_values.hpp>
#include <hardware_interface/types/hardware_interface_type_values.hpp>
#include <rclcpp/macros.hpp>
#include <rclcpp/rclcpp.hpp>
#include <rclcpp_lifecycle/node_interfaces/lifecycle_node_interface.hpp>
#include <rclcpp_lifecycle/state.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <std_msgs/msg/string.hpp>

using hardware_interface::return_type;
using CallbackReturn = rclcpp_lifecycle::node_interfaces::LifecycleNodeInterface::CallbackReturn;

namespace abb_hardware_interface
{
class ABBSystemHardware : public hardware_interface::SystemInterface
{
public:
  RCLCPP_SHARED_PTR_DEFINITIONS(ABBSystemHardware)

  ROS2_CONTROL_DRIVER_PUBLIC
  CallbackReturn on_init(const hardware_interface::HardwareInfo& info) override;

  ROS2_CONTROL_DRIVER_PUBLIC
  std::vector<hardware_interface::StateInterface> export_state_interfaces() override;

  ROS2_CONTROL_DRIVER_PUBLIC
  std::vector<hardware_interface::CommandInterface> export_command_interfaces() override;

  ROS2_CONTROL_DRIVER_PUBLIC
  CallbackReturn on_activate(const rclcpp_lifecycle::State& previous_state) override;

  ROS2_CONTROL_DRIVER_PUBLIC
  return_type read(const rclcpp::Time& time, const rclcpp::Duration& period) override;

  ROS2_CONTROL_DRIVER_PUBLIC
  return_type write(const rclcpp::Time& time, const rclcpp::Duration& period) override;

private:
  void initializeTelemetryPublishers();
  void publishTelemetry(const rclcpp::Time& time);
  void publishEgmState(const rclcpp::Time& time);
  void publishJointTelemetry(const rclcpp::Time& time, bool planned);
  void publishPoseTelemetry(const rclcpp::Time& time, bool planned);
  void publishRawEgmInput(const rclcpp::Time& time);

  // EGM
  abb::robot::RobotControllerDescription robot_controller_description_;
  std::unique_ptr<abb::robot::EGMManager> egm_manager_;

  // Store the state and commands for the robot(s)
  abb::robot::MotionData motion_data_;

  rclcpp::Node::SharedPtr telemetry_node_;
  rclcpp::Publisher<abb_egm_msgs::msg::EGMState>::SharedPtr egm_state_publisher_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr egm_feedback_joint_state_publisher_;
  rclcpp::Publisher<sensor_msgs::msg::JointState>::SharedPtr egm_planned_joint_state_publisher_;
  rclcpp::Publisher<geometry_msgs::msg::PoseStamped>::SharedPtr egm_feedback_pose_publisher_;
  rclcpp::Publisher<geometry_msgs::msg::PoseStamped>::SharedPtr egm_planned_pose_publisher_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr egm_raw_input_publisher_;
  rclcpp::Time last_telemetry_publish_time_{ 0, 0, RCL_ROS_TIME };
  double telemetry_publish_period_{ 0.1 };
  bool telemetry_enabled_{ true };
};

}  // namespace abb_hardware_interface
