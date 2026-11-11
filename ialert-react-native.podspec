require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ialert-react-native"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://ialert.ir"
  s.license      = package["license"]
  s.authors      = "iAlert"
  s.platforms    = { :ios => "13.4" }
  s.source       = { :git => "https://github.com/iAlert-ai/ialert-react-native.git", :tag => s.version.to_s }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.0"

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end
end
