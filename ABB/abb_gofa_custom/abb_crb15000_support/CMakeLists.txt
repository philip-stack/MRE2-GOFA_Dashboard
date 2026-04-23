cmake_minimum_required(VERSION 3.8)
project(abb_crb15000_support)

# ROS 2 uses ament instead of catkin
find_package(ament_cmake REQUIRED)

# Install directories (same as before)
install(
  DIRECTORY config launch meshes urdf
  DESTINATION share/${PROJECT_NAME}
)

# Install license file
install(
  FILES LICENSE
  DESTINATION share/${PROJECT_NAME}
)

# Testing (replacement for roslaunch check)
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  find_package(launch_testing_ament_cmake REQUIRED)

  # Optional: linting
  ament_lint_auto_find_test_dependencies()

  # Launch test equivalents (you need .py launch tests in ROS 2)
  # add_launch_test(tests/roslaunch_test_crb15000_5_95.launch.py)
  # add_launch_test(tests/roslaunch_test_crb15000_12_127.launch.py)
endif()

ament_package()
