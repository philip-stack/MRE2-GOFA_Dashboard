from setuptools import setup

package_name = "gofa_egm_driver"

setup(
    name=package_name,
    version="0.1.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        (f"share/{package_name}/launch", ["launch/egm_server.launch.py"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Philip",
    maintainer_email="philip@example.com",
    description="Minimal ABB EGM FollowJointTrajectory bridge for GoFa.",
    license="BSD-3-Clause",
    entry_points={
        "console_scripts": [
            "egm_trajectory_server = gofa_egm_driver.egm_trajectory_server:main",
        ],
    },
)
